export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug(fields: LogFields, message?: string): void;
  error(fields: LogFields, message?: string): void;
  info(fields: LogFields, message?: string): void;
  warn(fields: LogFields, message?: string): void;
};

export type JsonLoggerOptions = {
  now?: () => Date;
  service?: string;
  sink?: (line: string) => void;
};

const REDACTED = "[redacted]";
const SENSITIVE_KEY_NAMES = new Set([
  "apikey",
  "authorization",
  "cookie",
  "githubtoken",
  "installationtoken",
  "openaikey",
  "password",
  "privatekey",
  "secret",
  "setcookie",
  "token",
]);
const PROMPT_CONTENT_KEY_NAMES = new Set([
  "fullprompt",
  "messages",
  "prompt",
  "promptcontents",
  "systemprompt",
  "userprompt",
]);

export function createJsonLogger(options: JsonLoggerOptions = {}): Logger {
  const now = options.now ?? (() => new Date());
  const sink = options.sink ?? ((line: string) => console.log(line));
  const service = options.service;

  const write = (level: LogLevel, fields: LogFields, message?: string): void => {
    const entry = sanitizeLogFields({
      timestamp: now().toISOString(),
      level,
      ...(service === undefined ? {} : { service }),
      ...(message === undefined ? {} : { message }),
      ...fields,
    });

    sink(JSON.stringify(entry));
  };

  return {
    debug: (fields, message) => write("debug", fields, message),
    error: (fields, message) => write("error", fields, message),
    info: (fields, message) => write("info", fields, message),
    warn: (fields, message) => write("warn", fields, message),
  };
}

export function createNoopLogger(): Logger {
  return {
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  };
}

export function sanitizeLogFields(fields: LogFields): LogFields {
  return redactLogValue(fields) as LogFields;
}

export function redactLogValue(value: unknown): unknown {
  return redactUnknown(value, new WeakSet<object>(), undefined);
}

export function toErrorLogFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      error: {
        message: redactSecretLikeString(error.message),
        name: error.name,
      },
    };
  }

  return {
    error: {
      message: redactSecretLikeString(String(error)),
      name: "Error",
    },
  };
}

function redactUnknown(value: unknown, seen: WeakSet<object>, key: string | undefined): unknown {
  if (key !== undefined && isSensitiveKey(key)) {
    return REDACTED;
  }

  if (typeof value === "string") {
    return redactSecretLikeString(value);
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "undefined"
  ) {
    return value;
  }

  if (value instanceof Error) {
    return toErrorLogFields(value).error;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactUnknown(item, seen, undefined));
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[circular]";
    }

    seen.add(value);
    const sanitized: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      sanitized[entryKey] = redactUnknown(entryValue, seen, entryKey);
    }
    seen.delete(value);

    return sanitized;
  }

  return String(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[-_\s.]/g, "").toLowerCase();

  return (
    SENSITIVE_KEY_NAMES.has(normalized) ||
    PROMPT_CONTENT_KEY_NAMES.has(normalized) ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token")
  );
}

function redactSecretLikeString(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
      REDACTED,
    )
    .replace(/\b(authorization)\s*:\s*(bearer|basic)\s+[^\s,;]+/gi, "$1: $2 [redacted]")
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/-]{8,}/gi, "$1 [redacted]")
    .replace(/\b(?:sk|gh[pousr]|github_pat)[-_][A-Za-z0-9_-]{4,}\b/g, REDACTED)
    .replace(
      /\b(private[_-]?key|github[_-]?token|installation[_-]?token|token|secret|api[_-]?key|password|passwd|pwd)\s*[:=]\s*["']?[^"',\s]+/gi,
      "$1=[redacted]",
    );
}
