import { z } from "zod";

const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 120;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

const ApiEnvSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  DIFFGUARD_ALLOWED_ORIGINS: z.string().optional(),
  DIFFGUARD_BODY_LIMIT_BYTES: z.coerce.number().int().positive().optional(),
  DIFFGUARD_DASHBOARD_API_KEY: z.string().min(1).optional(),
  DIFFGUARD_DEMO_MODE: z.string().optional(),
  DIFFGUARD_GITHUB_APP_MODE: z.string().optional(),
  DIFFGUARD_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().optional(),
  DIFFGUARD_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
  HOST: z.string().min(1).optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  REVIEW_QUEUE_NAME: z.string().min(1).default("diffguard-review-runs"),
});

export type ApiConfig = {
  allowedOrigins: string[];
  bodyLimitBytes: number;
  dashboardApiKey?: string;
  databaseUrl?: string;
  demoMode: boolean;
  githubAppMode: boolean;
  host: string;
  nodeEnv: "development" | "production" | "test";
  openaiApiKey?: string;
  port: number;
  rateLimit: {
    maxRequests: number;
    windowMs: number;
  };
  redisUrl: string;
  reviewQueueName: string;
  webhookSecret?: string;
};

export function createApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const parsed = ApiEnvSchema.parse(env);
  const demoMode = parseBoolean(parsed.DIFFGUARD_DEMO_MODE, false);
  const production = parsed.NODE_ENV === "production";
  const allowedOrigins =
    parsed.DIFFGUARD_ALLOWED_ORIGINS === undefined || parsed.DIFFGUARD_ALLOWED_ORIGINS.trim() === ""
      ? production
        ? []
        : ["http://localhost:3000"]
      : splitCsv(parsed.DIFFGUARD_ALLOWED_ORIGINS);
  const githubAppMode =
    parseBoolean(parsed.DIFFGUARD_GITHUB_APP_MODE, parsed.GITHUB_APP_ID !== undefined || production);

  validateProductionConfig({
    allowedOrigins,
    demoMode,
    githubAppMode,
    parsed,
    production,
  });

  return {
    allowedOrigins,
    bodyLimitBytes: parsed.DIFFGUARD_BODY_LIMIT_BYTES ?? DEFAULT_BODY_LIMIT_BYTES,
    ...(parsed.DIFFGUARD_DASHBOARD_API_KEY === undefined
      ? {}
      : { dashboardApiKey: parsed.DIFFGUARD_DASHBOARD_API_KEY }),
    ...(parsed.DATABASE_URL === undefined ? {} : { databaseUrl: parsed.DATABASE_URL }),
    demoMode,
    githubAppMode,
    host: parsed.HOST ?? (production ? "0.0.0.0" : "127.0.0.1"),
    nodeEnv: parsed.NODE_ENV,
    ...(parsed.OPENAI_API_KEY === undefined ? {} : { openaiApiKey: parsed.OPENAI_API_KEY }),
    port: parsed.PORT ?? 3001,
    rateLimit: {
      maxRequests: parsed.DIFFGUARD_RATE_LIMIT_MAX_REQUESTS ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS,
      windowMs: parsed.DIFFGUARD_RATE_LIMIT_WINDOW_MS ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    },
    redisUrl: parsed.REDIS_URL,
    reviewQueueName: parsed.REVIEW_QUEUE_NAME,
    ...(parsed.GITHUB_WEBHOOK_SECRET === undefined ? {} : { webhookSecret: parsed.GITHUB_WEBHOOK_SECRET }),
  };
}

function validateProductionConfig(input: {
  allowedOrigins: string[];
  demoMode: boolean;
  githubAppMode: boolean;
  parsed: z.infer<typeof ApiEnvSchema>;
  production: boolean;
}): void {
  if (!input.production) {
    return;
  }

  const missing: string[] = [];
  if (input.parsed.DATABASE_URL === undefined) {
    missing.push("DATABASE_URL");
  }
  if (input.parsed.OPENAI_API_KEY === undefined) {
    missing.push("OPENAI_API_KEY");
  }
  if (!input.demoMode && input.parsed.DIFFGUARD_DASHBOARD_API_KEY === undefined) {
    missing.push("DIFFGUARD_DASHBOARD_API_KEY");
  }
  if (input.githubAppMode && input.parsed.GITHUB_WEBHOOK_SECRET === undefined) {
    missing.push("GITHUB_WEBHOOK_SECRET");
  }
  if (input.allowedOrigins.length === 0) {
    missing.push("DIFFGUARD_ALLOWED_ORIGINS");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }

  if (input.allowedOrigins.includes("*")) {
    throw new Error("DIFFGUARD_ALLOWED_ORIGINS must not use a wildcard in production.");
  }
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}
