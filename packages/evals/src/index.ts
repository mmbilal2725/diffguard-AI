import type { PullRequestFile, PullRequestMetadata } from "@diffguard/github";
import {
  runReviewPipeline,
  type LlmReviewer,
  type RejectedFinding,
  type ReviewPipelineGitHubClient,
  type ReviewResult,
} from "@diffguard/reviewer";
import {
  FindingCategorySchema,
  FindingSeveritySchema,
  ReviewFindingSchema,
  type FindingCategory,
  type FindingSeverity,
  type ReviewFinding,
} from "@diffguard/shared";
import { z } from "zod";

export const EvalExpectedFindingSchema = z
  .object({
    category: FindingCategorySchema,
    filePath: z.string().min(1),
    line: z.number().int().positive().optional(),
    severity: FindingSeveritySchema,
    title: z.string().min(8).max(160),
    titleKeywords: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const EvalCaseSchema = z
  .object({
    category: FindingCategorySchema,
    diff: z.string().min(1),
    expectedFindings: z.array(EvalExpectedFindingSchema),
    id: z.string().min(1),
    language: z.string().min(1),
    notes: z.string().min(1),
    repoRules: z.string(),
    severity: FindingSeveritySchema,
    shouldNotMention: z.array(z.string().min(1)),
    title: z.string().min(1),
  })
  .strict();

const EvalSuiteInputSchema = z.object({
  cases: z.array(EvalCaseSchema).optional(),
  modelVersion: z.string().min(1),
  promptVersion: z.string().min(1),
});

export type EvalExpectedFinding = z.infer<typeof EvalExpectedFindingSchema>;
export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalOutputFormat = "json" | "markdown";

export type EvalReviewerOutput = {
  costUsd?: number;
  findings: ReviewFinding[];
  latencyMs: number;
  modelVersion: string;
  promptVersion: string;
  rejectedFindings: RejectedFinding[];
};

export type EvalReviewer = (evalCase: EvalCase) => Promise<EvalReviewerOutput>;

export type EvalSuiteInput = z.input<typeof EvalSuiteInputSchema> & {
  reviewer?: EvalReviewer;
};

export type EvalFalsePositive = {
  caseId: string;
  category: FindingCategory;
  filePath: string;
  line: number;
  reason: "unexpected_finding" | "mentioned_forbidden_text";
  severity: FindingSeverity;
  title: string;
};

export type EvalFalseNegative = {
  caseId: string;
  category: FindingCategory;
  filePath: string;
  line?: number;
  severity: FindingSeverity;
  title: string;
};

export type EvalCaseResult = {
  caseId: string;
  costUsd: number;
  falseNegatives: EvalFalseNegative[];
  falsePositives: EvalFalsePositive[];
  findings: ReviewFinding[];
  latencyMs: number;
  matchedExpectedFindings: EvalExpectedFinding[];
  rejectedFindings: RejectedFinding[];
};

export type EvalSummary = {
  caseCount: number;
  costUsd: number;
  falseNegativeCount: number;
  falsePositiveCount: number;
  findingsPerPr: number;
  latencyMs: number;
  modelVersion: string;
  precision: number;
  promptVersion: string;
  recall: number;
  truePositiveCount: number;
  validatorRejectionRate: number;
};

export type EvalReport = {
  caseResults: EvalCaseResult[];
  falseNegatives: EvalFalseNegative[];
  falsePositives: EvalFalsePositive[];
  passed: boolean;
  summary: EvalSummary;
};

export const starterTypeScriptEvalCases: EvalCase[] = [
  {
    category: "authorization",
    diff: [
      "diff --git a/src/admin/users.ts b/src/admin/users.ts",
      "@@ -8,8 +8,8 @@ export async function listUsers(req: Request) {",
      "-  await requireAdmin(req.user);",
      "+  // auth moved to caller",
      "   return db.user.findMany({ select: { id: true, email: true } });",
    ].join("\n"),
    expectedFindings: [
      expectedFinding({
        category: "authorization",
        filePath: "src/admin/users.ts",
        line: 10,
        severity: "high",
        title: "Admin endpoint is missing authorization",
        titleKeywords: ["admin", "authorization"],
      }),
    ],
    id: "ts-missing-authorization-check",
    language: "typescript",
    notes: "The changed route returns private user data after removing the explicit admin guard.",
    repoRules: "All admin routes must call requireAdmin(). Only comment when confidence is high.",
    severity: "high",
    shouldNotMention: ["rename", "formatting"],
    title: "Missing authorization check",
  },
  {
    category: "logic",
    diff: [
      "diff --git a/src/profile.ts b/src/profile.ts",
      "@@ -14,9 +14,7 @@ export function renderProfile(user?: User) {",
      "-  if (!user) return 'Anonymous';",
      "-",
      "+  const displayName = user.name.trim();",
      "   return displayName;",
    ].join("\n"),
    expectedFindings: [
      expectedFinding({
        category: "logic",
        filePath: "src/profile.ts",
        line: 16,
        severity: "medium",
        title: "Profile rendering is missing a null check",
        titleKeywords: ["null", "user"],
      }),
    ],
    id: "ts-missing-null-check",
    language: "typescript",
    notes: "The diff removes the guard before dereferencing an optional user.",
    repoRules: "Only comment on concrete runtime failures introduced by the diff.",
    severity: "medium",
    shouldNotMention: ["optional chaining preference"],
    title: "Missing null check",
  },
  {
    category: "security",
    diff: [
      "diff --git a/src/search.ts b/src/search.ts",
      "@@ -4,7 +4,7 @@ export async function searchUsers(q: string) {",
      "-  return db.query('select * from users where email = ?', [q]);",
      "+  return db.query(`select * from users where email = '${q}'`);",
    ].join("\n"),
    expectedFindings: [
      expectedFinding({
        category: "security",
        filePath: "src/search.ts",
        line: 6,
        severity: "critical",
        title: "Search query introduces SQL injection",
        titleKeywords: ["sql", "injection"],
      }),
    ],
    id: "ts-sql-injection-risk",
    language: "typescript",
    notes: "The parameterized query was replaced with string interpolation of user input.",
    repoRules: "Never concatenate user input into SQL queries.",
    severity: "critical",
    shouldNotMention: ["template string style"],
    title: "SQL injection risk",
  },
  {
    category: "logic",
    diff: [
      "diff --git a/src/pagination.ts b/src/pagination.ts",
      "@@ -10,7 +10,7 @@ export function paginate(page: number, pageSize: number) {",
      "-  const offset = (page - 1) * pageSize;",
      "+  const offset = page * pageSize;",
      "   return { limit: pageSize, offset };",
    ].join("\n"),
    expectedFindings: [
      expectedFinding({
        category: "logic",
        filePath: "src/pagination.ts",
        line: 12,
        severity: "medium",
        title: "Pagination skips the first page",
        titleKeywords: ["pagination", "offset"],
      }),
    ],
    id: "ts-broken-pagination",
    language: "typescript",
    notes: "The offset calculation now skips page one when page is one-indexed.",
    repoRules: "Pagination page numbers are one-indexed in public APIs.",
    severity: "medium",
    shouldNotMention: ["micro optimization"],
    title: "Broken pagination",
  },
  {
    category: "data-loss",
    diff: [
      "diff --git a/prisma/migrations/20260620_drop_email.sql b/prisma/migrations/20260620_drop_email.sql",
      "@@ -0,0 +1,2 @@",
      "+ALTER TABLE users DROP COLUMN email;",
      "+ALTER TABLE users ADD COLUMN contact_email TEXT NOT NULL;",
    ].join("\n"),
    expectedFindings: [
      expectedFinding({
        category: "data-loss",
        filePath: "prisma/migrations/20260620_drop_email.sql",
        line: 1,
        severity: "critical",
        title: "Migration drops user email data",
        titleKeywords: ["migration", "drop"],
      }),
    ],
    id: "ts-unsafe-database-migration",
    language: "typescript",
    notes: "The migration destroys data without a backfill or explicit approval.",
    repoRules: "Database migrations must avoid destructive changes unless explicitly approved.",
    severity: "critical",
    shouldNotMention: ["file naming"],
    title: "Unsafe database migration",
  },
  {
    category: "logic",
    diff: [
      "diff --git a/src/money.ts b/src/money.ts",
      "@@ -3,7 +3,7 @@ export function applyDiscount(cents: number, percent: number) {",
      "-  return cents - Math.round((cents * percent) / 100);",
      "+  return cents - percent / 100;",
    ].join("\n"),
    expectedFindings: [
      expectedFinding({
        category: "logic",
        filePath: "src/money.ts",
        line: 5,
        severity: "high",
        title: "Discount calculation mixes cents and percentages",
        titleKeywords: ["money", "calculation"],
      }),
    ],
    id: "ts-incorrect-money-calculation",
    language: "typescript",
    notes: "The new calculation subtracts a fractional rate from a minor-unit amount.",
    repoRules: "All money values must be stored and calculated in minor units.",
    severity: "high",
    shouldNotMention: ["decimal formatting"],
    title: "Incorrect money calculation",
  },
  {
    category: "reliability",
    diff: [
      "diff --git a/src/jobs.ts b/src/jobs.ts",
      "@@ -20,7 +20,7 @@ export async function enqueueInvoice(id: string) {",
      "-  await queue.add('invoice', { id });",
      "+  queue.add('invoice', { id });",
      "   return { queued: true };",
    ].join("\n"),
    expectedFindings: [
      expectedFinding({
        category: "reliability",
        filePath: "src/jobs.ts",
        line: 22,
        severity: "medium",
        title: "Invoice enqueue no longer awaits queue failure",
        titleKeywords: ["missing", "await"],
      }),
    ],
    id: "ts-missing-await",
    language: "typescript",
    notes: "The function reports success before the queue operation can fail.",
    repoRules: "Async side effects must be awaited when their failure changes API behavior.",
    severity: "medium",
    shouldNotMention: ["promise style"],
    title: "Missing await",
  },
  {
    category: "reliability",
    diff: [
      "diff --git a/src/inventory.ts b/src/inventory.ts",
      "@@ -31,9 +31,10 @@ export async function reserveSku(sku: string) {",
      "   const item = await db.item.findUnique({ where: { sku } });",
      "+  if (item.stock <= 0) throw new Error('sold out');",
      "+  await db.item.update({ where: { sku }, data: { stock: item.stock - 1 } });",
      "-  await db.item.update({ where: { sku }, data: { stock: { decrement: 1 } } });",
      "   return true;",
    ].join("\n"),
    expectedFindings: [
      expectedFinding({
        category: "reliability",
        filePath: "src/inventory.ts",
        line: 33,
        severity: "high",
        title: "Inventory reservation has a race condition",
        titleKeywords: ["race", "condition"],
      }),
    ],
    id: "ts-race-condition",
    language: "typescript",
    notes: "The read-then-write stock update can oversell under concurrent requests.",
    repoRules: "Inventory decrements must be atomic.",
    severity: "high",
    shouldNotMention: ["transaction preference without race"],
    title: "Race condition",
  },
  {
    category: "security",
    diff: [
      "diff --git a/src/auth.ts b/src/auth.ts",
      "@@ -44,7 +44,7 @@ export async function refresh(token: string) {",
      "+  logger.info({ token }, 'refresh token received');",
      "   return rotateRefreshToken(token);",
    ].join("\n"),
    expectedFindings: [
      expectedFinding({
        category: "security",
        filePath: "src/auth.ts",
        line: 45,
        severity: "high",
        title: "Refresh token is logged",
        titleKeywords: ["token", "logged"],
      }),
    ],
    id: "ts-insecure-logging",
    language: "typescript",
    notes: "The diff logs a raw refresh token.",
    repoRules: "Never log API keys, access tokens, or refresh tokens.",
    severity: "high",
    shouldNotMention: ["log message wording"],
    title: "Insecure logging",
  },
  {
    category: "testing",
    diff: [
      "diff --git a/src/tax.ts b/src/tax.ts",
      "@@ -8,7 +8,7 @@ export function calculateTax(cents: number, region: Region) {",
      "-  if (region === 'EU') return Math.round(cents * 0.2);",
      "+  if (region === 'EU') return Math.round(cents * 0.21);",
      "   return Math.round(cents * 0.08);",
    ].join("\n"),
    expectedFindings: [
      expectedFinding({
        category: "testing",
        filePath: "src/tax.ts",
        line: 10,
        severity: "medium",
        title: "Tax behavior changed without a regression test",
        titleKeywords: ["missing", "test"],
      }),
    ],
    id: "ts-missing-test-for-changed-behavior",
    language: "typescript",
    notes: "The diff changes tax behavior without nearby test changes or an updated expected value.",
    repoRules:
      "Behavior changes need tests. Only comment on missing tests for concrete changed behavior.",
    severity: "medium",
    shouldNotMention: ["coverage percentage"],
    title: "Missing test for changed behavior",
  },
  {
    category: "logic",
    diff: [
      "diff --git a/src/user-card.tsx b/src/user-card.tsx",
      "@@ -12,7 +12,7 @@ export function UserCard({ user }: Props) {",
      "-  const displayName = user.name;",
      "+  const displayName = user.fullName;",
      "   return <span>{displayName}</span>;",
    ].join("\n"),
    expectedFindings: [],
    id: "ts-false-positive-style-only-trap",
    language: "typescript",
    notes:
      "The diff is a benign field rename with no evidence of broken behavior; useful reviewers should stay silent.",
    repoRules:
      "Ignore formatting-only suggestions. Do not comment on naming or style unless there is a concrete bug.",
    severity: "low",
    shouldNotMention: ["rename", "formatting", "style-only"],
    title: "False-positive trap for style-only comments",
  },
];

export async function runEvalSuite(input: EvalSuiteInput): Promise<EvalReport> {
  const parsed = EvalSuiteInputSchema.parse(input);
  const cases = parsed.cases ?? starterTypeScriptEvalCases;
  const reviewer = input.reviewer ?? createPipelineEvalReviewer();
  const caseResults: EvalCaseResult[] = [];

  for (const evalCase of cases) {
    caseResults.push(
      scoreCase({
        evalCase,
        output: await reviewer(evalCase),
      }),
    );
  }

  const falsePositives = caseResults.flatMap((result) => result.falsePositives);
  const falseNegatives = caseResults.flatMap((result) => result.falseNegatives);
  const truePositiveCount = caseResults.reduce(
    (total, result) => total + result.matchedExpectedFindings.length,
    0,
  );
  const postedFindings = caseResults.reduce((total, result) => total + result.findings.length, 0);
  const rejectedFindings = caseResults.reduce(
    (total, result) => total + result.rejectedFindings.length,
    0,
  );
  const validatorRejections = caseResults.reduce(
    (total, result) => total + result.rejectedFindings.filter(isValidatorRejection).length,
    0,
  );
  const expectedFindings = cases.reduce(
    (total, evalCase) => total + evalCase.expectedFindings.length,
    0,
  );

  return {
    caseResults,
    falseNegatives,
    falsePositives,
    passed: falsePositives.length === 0 && falseNegatives.length === 0,
    summary: {
      caseCount: cases.length,
      costUsd: roundCurrency(caseResults.reduce((total, result) => total + result.costUsd, 0)),
      falseNegativeCount: falseNegatives.length,
      falsePositiveCount: falsePositives.length,
      findingsPerPr: cases.length === 0 ? 0 : postedFindings / cases.length,
      latencyMs: caseResults.reduce((total, result) => total + result.latencyMs, 0),
      modelVersion: parsed.modelVersion,
      precision: calculatePrecision(truePositiveCount, falsePositives.length),
      promptVersion: parsed.promptVersion,
      recall: expectedFindings === 0 ? 1 : truePositiveCount / expectedFindings,
      truePositiveCount,
      validatorRejectionRate:
        postedFindings + rejectedFindings === 0
          ? 0
          : validatorRejections / (postedFindings + rejectedFindings),
    },
  };
}

export function formatEvalReport(report: EvalReport, output: EvalOutputFormat): string {
  if (output === "json") {
    return JSON.stringify(report, null, 2);
  }

  const lines = [
    "## DiffGuard-AI Eval Report",
    "",
    `Status: ${report.passed ? "passed" : "failed"}`,
    `Cases: ${report.summary.caseCount}`,
    `Precision: ${formatRatio(report.summary.precision)}`,
    `Recall: ${formatRatio(report.summary.recall)}`,
    `False positives: ${report.summary.falsePositiveCount}`,
    `False negatives: ${report.summary.falseNegativeCount}`,
    `Validator rejection rate: ${formatRatio(report.summary.validatorRejectionRate)}`,
    `Cost: $${report.summary.costUsd.toFixed(4)}`,
    `Latency: ${report.summary.latencyMs}ms`,
    `Findings per PR: ${report.summary.findingsPerPr.toFixed(2)}`,
    `Prompt version: ${report.summary.promptVersion}`,
    `Model version: ${report.summary.modelVersion}`,
  ];

  if (report.falsePositives.length > 0) {
    lines.push("", "### False Positives", "");
    report.falsePositives.forEach((finding) => {
      lines.push(`- ${finding.caseId}: ${finding.title} (${finding.reason})`);
    });
  }

  if (report.falseNegatives.length > 0) {
    lines.push("", "### False Negatives", "");
    report.falseNegatives.forEach((finding) => {
      lines.push(`- ${finding.caseId}: ${finding.title}`);
    });
  }

  return lines.join("\n");
}

export function createPipelineEvalReviewer(input: {
  llmReviewer?: LlmReviewer;
  modelVersion?: string;
  promptVersion?: string;
} = {}): EvalReviewer {
  return async (evalCase) => {
    const startedAt = Date.now();
    const result = await runReviewPipeline({
      dryRun: true,
      findingValidator: async () => ({
        confidence: 1,
        falsePositiveRisk: "low",
        reason: "Eval validator accepts structured candidates so scoring can judge output.",
        shouldPost: true,
        valid: true,
      }),
      github: { client: createEvalGitHubClient(evalCase) },
      llmReviewer: input.llmReviewer,
      owner: "diffguard-ai",
      pullNumber: 1,
      repo: "eval-case",
    });

    return {
      costUsd: 0,
      findings: result.findings,
      latencyMs: totalLatency(result, Date.now() - startedAt),
      modelVersion: input.modelVersion ?? "not-configured",
      promptVersion: input.promptVersion ?? "not-configured",
      rejectedFindings: result.rejectedFindings,
    };
  };
}

function scoreCase(input: { evalCase: EvalCase; output: EvalReviewerOutput }): EvalCaseResult {
  const findings = input.output.findings.map((finding) => ReviewFindingSchema.parse(finding));
  const matchedFindingIndexes = new Set<number>();
  const matchedExpectedFindings: EvalExpectedFinding[] = [];
  const falseNegatives: EvalFalseNegative[] = [];

  for (const expected of input.evalCase.expectedFindings) {
    const matchIndex = findings.findIndex(
      (finding, index) =>
        !matchedFindingIndexes.has(index) && findingMatchesExpected(finding, expected),
    );

    if (matchIndex === -1) {
      falseNegatives.push({
        caseId: input.evalCase.id,
        category: expected.category,
        filePath: expected.filePath,
        ...(expected.line === undefined ? {} : { line: expected.line }),
        severity: expected.severity,
        title: expected.title,
      });
      continue;
    }

    matchedFindingIndexes.add(matchIndex);
    matchedExpectedFindings.push(expected);
  }

  const falsePositives = findings.flatMap((finding, index) => {
    const forbiddenText = findForbiddenMention(finding, input.evalCase.shouldNotMention);

    if (forbiddenText !== undefined) {
      return [toFalsePositive(input.evalCase.id, finding, "mentioned_forbidden_text")];
    }

    if (!matchedFindingIndexes.has(index)) {
      return [toFalsePositive(input.evalCase.id, finding, "unexpected_finding")];
    }

    return [];
  });

  return {
    caseId: input.evalCase.id,
    costUsd: input.output.costUsd ?? 0,
    falseNegatives,
    falsePositives,
    findings,
    latencyMs: input.output.latencyMs,
    matchedExpectedFindings,
    rejectedFindings: input.output.rejectedFindings,
  };
}

function expectedFinding(input: EvalExpectedFinding): EvalExpectedFinding {
  return input;
}

function calculatePrecision(truePositives: number, falsePositives: number): number {
  const postedFindings = truePositives + falsePositives;

  if (postedFindings === 0) {
    return 0;
  }

  return truePositives / postedFindings;
}

function findingMatchesExpected(finding: ReviewFinding, expected: EvalExpectedFinding): boolean {
  if (
    finding.category !== expected.category ||
    finding.severity !== expected.severity ||
    finding.filePath !== expected.filePath
  ) {
    return false;
  }

  if (expected.line !== undefined && finding.line !== expected.line) {
    return false;
  }

  const searchableText = normalizeText(
    [finding.title, finding.summary, finding.evidence, finding.whyItMatters].join(" "),
  );

  return expected.titleKeywords.every((keyword) => searchableText.includes(normalizeText(keyword)));
}

function findForbiddenMention(
  finding: ReviewFinding,
  shouldNotMention: string[],
): string | undefined {
  const searchableText = normalizeText(
    [
      finding.title,
      finding.summary,
      finding.evidence,
      finding.suggestedFix,
      finding.whyItMatters,
      finding.improvedComment ?? "",
    ].join(" "),
  );

  return shouldNotMention.find((phrase) => searchableText.includes(normalizeText(phrase)));
}

function toFalsePositive(
  caseId: string,
  finding: ReviewFinding,
  reason: EvalFalsePositive["reason"],
): EvalFalsePositive {
  return {
    caseId,
    category: finding.category,
    filePath: finding.filePath,
    line: finding.line,
    reason,
    severity: finding.severity,
    title: finding.title,
  };
}

function createEvalGitHubClient(evalCase: EvalCase): ReviewPipelineGitHubClient {
  const pullRequest: PullRequestMetadata = {
    additions: countLines(evalCase.diff, "+"),
    baseRef: "main",
    baseSha: "base-sha",
    changedFiles: 1,
    deletions: countLines(evalCase.diff, "-"),
    draft: false,
    headRef: evalCase.id,
    headSha: "head-sha",
    htmlUrl: `https://github.com/diffguard-ai/eval-case/pull/${encodeURIComponent(evalCase.id)}`,
    id: 1,
    number: 1,
    state: "open",
    title: evalCase.title,
  };
  const file: PullRequestFile = {
    additions: pullRequest.additions,
    changes: pullRequest.additions + pullRequest.deletions,
    deletions: pullRequest.deletions,
    filename: readFirstDiffFilePath(evalCase.diff),
    patch: evalCase.diff,
    sha: "file-sha",
    status: "modified",
  };

  return {
    fetchPullRequestDiff: async () => ({ ok: true, data: evalCase.diff }),
    getPullRequestMetadata: async () => ({ ok: true, data: pullRequest }),
    listPullRequestFiles: async () => ({ ok: true, data: [file] }),
    readDiffGuardRules: async () => ({ ok: true, data: evalCase.repoRules }),
  };
}

function readFirstDiffFilePath(diff: string): string {
  const match = /^diff --git a\/\S+ b\/(?<path>\S+)/m.exec(diff);

  return match?.groups?.path ?? "eval-case.ts";
}

function countLines(diff: string, prefix: "+" | "-"): number {
  return diff
    .split("\n")
    .filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`))
    .length;
}

function isValidatorRejection(finding: RejectedFinding): boolean {
  return (
    finding.reason === "validator_low_confidence" ||
    finding.reason === "validator_rejected" ||
    finding.reason === "high_false_positive_risk"
  );
}

function totalLatency(result: ReviewResult, fallbackMs: number): number {
  const fromTimings = result.timings.reduce((total, timing) => total + timing.durationMs, 0);

  return fromTimings === 0 ? fallbackMs : fromTimings;
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatRatio(value: number): string {
  return value.toFixed(2);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
