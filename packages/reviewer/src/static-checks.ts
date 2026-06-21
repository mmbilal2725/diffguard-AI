import type { PullRequestFile } from "@diffguard/github";

import type { ReviewContext, ReviewerFindingCandidate } from "./index.js";

type AddedLine = {
  content: string;
  line: number;
};

const SECRET_NAME_PATTERN =
  /(api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret|password|passwd|secret|token)/i;
const SECRET_VALUE_PATTERN =
  /(sk_live_[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|[A-Za-z0-9+/]{32,}={0,2})/;
const LOGGING_PATTERN = /\b(console\.(log|debug|info|warn|error)|logger\.(debug|info|warn|error)|log\.(debug|info|warn|error))\s*\(/i;
const DEFAULT_ADMIN_GUARD_PATTERN =
  /\b(requireAdmin|requireAuth|ensureAdmin|ensureAuth|withAdmin|withAuth|authorize|isAdmin|authGuard|adminGuard)\s*\(/i;
const ADMIN_ROUTE_PATTERN =
  /\b(router|app)\.(get|post|put|patch|delete|use)\s*\(\s*["'`][^"'`]*\/admin\b/i;
const DESTRUCTIVE_MIGRATION_PATTERN =
  /\b(drop\s+table|drop\s+column|alter\s+table\b.*\bdrop\b|truncate\s+table|delete\s+from\b(?!.*\bwhere\b))/i;
const PRODUCTION_URL_PATTERN =
  /\b[A-Z0-9_]*(DATABASE_URL|REDIS_URL|API_URL|BASE_URL|HOST|PASSWORD|USERNAME|USER|DSN)[A-Z0-9_]*\b\s*[:=]\s*["'`](https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[^"'`]*(\.com|\.net|\.org|prod|production|amazonaws\.com|azurewebsites\.net|cloudfront\.net)[^"'`]*|[a-z]+:\/\/[^"'`]*:[^"'`]*@[^"'`]+)["'`]/i;
const TEST_FILE_PATTERN = /(^|[\\/])(__tests__|tests?)([\\/]|$)|\.(test|spec)\.[cm]?[jt]sx?$/i;
const CRITICAL_FILE_PATTERN =
  /(^|[\\/])(admin|auth|authorization|permissions|payment|payments|billing|checkout|invoice|invoices|webhooks?|middleware)([\\/]|\.|-|_)/i;

export async function runDefaultStaticChecks(
  context: ReviewContext,
): Promise<ReviewerFindingCandidate[]> {
  const findings: ReviewerFindingCandidate[] = [];
  const hasTestChange = context.files.some((file) => TEST_FILE_PATTERN.test(file.filename));
  const adminGuardPattern = buildAdminGuardPattern(context.rules.content);

  for (const file of context.files) {
    const addedLines = parseAddedLines(file.patch);
    if (addedLines.length === 0) {
      continue;
    }

    const fileFindings = [
      ...findSecrets(file, addedLines),
      ...findSensitiveLogging(file, addedLines),
      ...findAdminRoutesWithoutGuard(file, addedLines, adminGuardPattern, context),
      ...findDestructiveMigrations(file, addedLines),
      ...findHardcodedProductionValues(file, addedLines),
    ];
    findings.push(...fileFindings);

    const missingTestsFinding =
      fileFindings.length === 0 ? findMissingCriticalTests(file, addedLines, hasTestChange) : null;
    if (missingTestsFinding !== null) {
      findings.push(missingTestsFinding);
    }
  }

  return findings;
}

function findSecrets(file: PullRequestFile, addedLines: AddedLine[]): ReviewerFindingCandidate[] {
  return addedLines
    .filter((line) => SECRET_NAME_PATTERN.test(line.content) && SECRET_VALUE_PATTERN.test(line.content))
    .map((line) =>
      createFinding({
        category: "security",
        confidence: 0.92,
        evidence: "An added line assigns a high-entropy value to a secret-like name; the value is intentionally omitted.",
        file,
        line,
        severity: "critical",
        suggestedFix:
          "Remove the committed secret, rotate it if it was real, and read the value from a secret manager or environment variable.",
        title: "Possible secret committed in diff",
        whyItMatters:
          "Committed secrets can be copied from repository history and used to access private systems.",
      }),
    );
}

function findSensitiveLogging(
  file: PullRequestFile,
  addedLines: AddedLine[],
): ReviewerFindingCandidate[] {
  return addedLines
    .filter((line) => LOGGING_PATTERN.test(line.content) && SECRET_NAME_PATTERN.test(line.content))
    .map((line) =>
      createFinding({
        category: "security",
        confidence: 0.9,
        evidence: "An added logging call references a token, API key, private key, or password-like value.",
        file,
        line,
        severity: "high",
        suggestedFix:
          "Remove the sensitive value from the log statement or replace it with a non-sensitive identifier.",
        title: "Sensitive value is logged",
        whyItMatters:
          "Logs are often shared broadly and retained longer than request data, so logged credentials can leak.",
      }),
    );
}

function findAdminRoutesWithoutGuard(
  file: PullRequestFile,
  addedLines: AddedLine[],
  adminGuardPattern: RegExp,
  context: ReviewContext,
): ReviewerFindingCandidate[] {
  const patch = file.patch ?? "";
  if (adminGuardPattern.test(patch)) {
    return [];
  }

  return addedLines
    .filter((line) => ADMIN_ROUTE_PATTERN.test(line.content))
    .map((line) =>
      createFinding({
        category: "authorization",
        confidence: 0.88,
        evidence:
          "An added admin route handler does not include an obvious auth guard in the changed patch.",
        file,
        line,
        relatedRuleIds: context.rules.found ? [context.rules.path] : [],
        severity: "high",
        suggestedFix:
          "Add the repository's admin authorization guard before the handler returns protected data or performs privileged work.",
        title: "Admin route appears to miss an auth guard",
        whyItMatters:
          "Admin routes without an authorization guard can expose privileged actions or data to non-admin users.",
      }),
    );
}

function findDestructiveMigrations(
  file: PullRequestFile,
  addedLines: AddedLine[],
): ReviewerFindingCandidate[] {
  if (!isMigrationFile(file.filename)) {
    return [];
  }

  return addedLines
    .filter((line) => DESTRUCTIVE_MIGRATION_PATTERN.test(line.content))
    .map((line) =>
      createFinding({
        category: "data-loss",
        confidence: 0.93,
        evidence: "A database migration adds a destructive SQL keyword or operation.",
        file,
        line,
        severity: "critical",
        suggestedFix:
          "Confirm the data-loss impact, add a reversible/backfill plan, or require explicit approval before applying this migration.",
        title: "Destructive database migration keyword",
        whyItMatters:
          "Destructive migrations can permanently remove production data if they run without a migration plan.",
      }),
    );
}

function findHardcodedProductionValues(
  file: PullRequestFile,
  addedLines: AddedLine[],
): ReviewerFindingCandidate[] {
  return addedLines
    .filter((line) => PRODUCTION_URL_PATTERN.test(line.content))
    .map((line) =>
      createFinding({
        category: "security",
        confidence: 0.86,
        evidence:
          "An added line hardcodes a production-looking URL or credential-bearing connection string.",
        file,
        line,
        severity: "medium",
        suggestedFix:
          "Move the production URL or credential into environment-specific configuration or a secret store.",
        title: "Hardcoded production URL or credential",
        whyItMatters:
          "Hardcoded production endpoints and credentials make deployments harder to isolate and can leak sensitive access details.",
      }),
    );
}

function findMissingCriticalTests(
  file: PullRequestFile,
  addedLines: AddedLine[],
  hasTestChange: boolean,
): ReviewerFindingCandidate | null {
  if (hasTestChange || TEST_FILE_PATTERN.test(file.filename) || !CRITICAL_FILE_PATTERN.test(file.filename)) {
    return null;
  }

  const firstAddedLine = addedLines[0];
  if (firstAddedLine === undefined) {
    return null;
  }

  return createFinding({
    category: "testing",
    confidence: 0.84,
    evidence:
      "A critical auth, admin, payment, billing, checkout, webhook, or middleware file changed without any test file changes in the pull request.",
    file,
    line: firstAddedLine,
    severity: "medium",
    suggestedFix:
      "Add or update a focused test that covers the changed critical behavior before merging.",
    title: "Critical file changed without tests",
    whyItMatters:
      "Critical flows are high-regression-risk areas, and missing test updates make behavior changes harder to verify.",
  });
}

function createFinding(input: {
  category: ReviewerFindingCandidate["category"];
  confidence: number;
  evidence: string;
  file: PullRequestFile;
  line: AddedLine;
  relatedRuleIds?: string[];
  severity: ReviewerFindingCandidate["severity"];
  suggestedFix: string;
  title: string;
  whyItMatters: string;
}): ReviewerFindingCandidate {
  return {
    category: input.category,
    confidence: input.confidence,
    evidence: input.evidence,
    filePath: input.file.filename,
    line: input.line.line,
    relatedRuleIds: input.relatedRuleIds ?? [],
    severity: input.severity,
    side: "RIGHT",
    suggestedFix: input.suggestedFix,
    summary: input.evidence,
    title: input.title,
    whyItMatters: input.whyItMatters,
  };
}

function parseAddedLines(patch: string | undefined): AddedLine[] {
  if (patch === undefined || patch.trim() === "") {
    return [];
  }

  const addedLines: AddedLine[] = [];
  let newLine = 0;

  for (const rawLine of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(rawLine);
    if (hunk !== null) {
      newLine = Number.parseInt(hunk[1] ?? "0", 10);
      continue;
    }

    if (rawLine.startsWith("+++") || rawLine.startsWith("---")) {
      continue;
    }

    if (rawLine.startsWith("+")) {
      addedLines.push({
        content: rawLine.slice(1),
        line: newLine,
      });
      newLine += 1;
      continue;
    }

    if (!rawLine.startsWith("-")) {
      newLine += 1;
    }
  }

  return addedLines;
}

function buildAdminGuardPattern(rules: string | null): RegExp {
  const ruleGuards =
    rules
      ?.match(/\b(require[A-Z]\w*|ensure[A-Z]\w*|with[A-Z]\w*|authorize[A-Z]\w*|auth[A-Z]\w*)\s*\(/g)
      ?.map((guard) => guard.replace(/\s*\($/, "")) ?? [];

  if (ruleGuards.length === 0) {
    return DEFAULT_ADMIN_GUARD_PATTERN;
  }

  return new RegExp(`${DEFAULT_ADMIN_GUARD_PATTERN.source}|\\b(${ruleGuards.map(escapeRegExp).join("|")})\\s*\\(`, "i");
}

function isMigrationFile(filename: string): boolean {
  return /(^|[\\/])(migrations?|prisma)([\\/]|$)|\.(sql|prisma)$/i.test(filename);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
