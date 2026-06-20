export type ReviewRunStatus = "queued" | "analyzing" | "validating" | "completed" | "failed";

export type ValidatorDecision = "accepted" | "rejected" | "deduplicated";

export type GitHubCommentStatus = "posted" | "skipped" | "pending" | "failed";

export interface Finding {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium";
  file: string;
  line: number;
  confidence: number;
  status: GitHubCommentStatus;
  summary: string;
}

export interface ReviewRun {
  id: string;
  createdAt: string;
  repo: string;
  prNumber: number;
  title: string;
  status: ReviewRunStatus;
  findingsCount: number;
  candidatesCount: number;
  costUsd: number;
  latencySeconds: number;
  confidenceThreshold: number;
  githubCommentStatus: GitHubCommentStatus;
  findings: Finding[];
  validatorDecisions: Array<{
    id: string;
    finding: string;
    decision: ValidatorDecision;
    reason: string;
    confidence: number;
  }>;
  modelCalls: Array<{
    id: string;
    model: string;
    purpose: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
  }>;
}

export interface RepositorySettings {
  id: string;
  repo: string;
  installation: string;
  enabled: boolean;
  confidenceThreshold: number;
  maxFindingsPerPr: number;
  rulesPath: string;
  lastReviewedAt: string;
}

export interface EvalRun {
  id: string;
  name: string;
  createdAt: string;
  precision: number;
  recall: number;
  falsePositives: number;
  falseNegatives: number;
  costUsd: number;
  cases: number;
}

export interface DashboardMetrics {
  totalPrsReviewed: number;
  findingsPosted: number;
  resolvedFindings: number;
  unresolvedFindings: number;
  falsePositiveFindings: number;
  unknownFindings: number;
  validatorRejectionRate: number;
  estimatedResolutionRate: number;
  totalCostUsd: number;
  averageLatencySeconds: number;
}

const overviewSnapshot = {
  totalPrsReviewed: 186,
  validatorAccepted: 341,
  validatorRejected: 176,
  resolvedFindings: 245,
  unresolvedFindings: 66,
  falsePositiveFindings: 18,
  unknownFindings: 12,
  totalCostUsd: 128.44,
  latencySamplesSeconds: [42, 51, 47, 56, 44]
};

const reviewRuns: ReviewRun[] = [
  {
    id: "rvw_1042",
    createdAt: "2026-06-19T19:42:00.000Z",
    repo: "acme/payments",
    prNumber: 482,
    title: "Prevent duplicate capture on retry",
    status: "completed",
    findingsCount: 3,
    candidatesCount: 7,
    costUsd: 0.58,
    latencySeconds: 52,
    confidenceThreshold: 0.82,
    githubCommentStatus: "posted",
    findings: [
      {
        id: "fnd_701",
        title: "Retry path can capture the same payment twice",
        severity: "critical",
        file: "apps/api/src/payments/capture.ts",
        line: 118,
        confidence: 0.94,
        status: "posted",
        summary: "The idempotency key is rebuilt on every retry, so provider retries can create a second capture."
      },
      {
        id: "fnd_702",
        title: "Refund endpoint skips tenant authorization",
        severity: "high",
        file: "apps/api/src/payments/refund.ts",
        line: 74,
        confidence: 0.91,
        status: "posted",
        summary: "The handler validates the user but does not verify that the payment belongs to the active tenant."
      },
      {
        id: "fnd_703",
        title: "Migration drops audit metadata without backfill",
        severity: "medium",
        file: "packages/database/prisma/migrations/2026061901.sql",
        line: 12,
        confidence: 0.86,
        status: "posted",
        summary: "The migration removes the source column before the worker has copied audit records."
      }
    ],
    validatorDecisions: [
      {
        id: "val_9001",
        finding: "Duplicate payment capture",
        decision: "accepted",
        reason: "Reproduced against changed retry branch and maps to a concrete line.",
        confidence: 0.94
      },
      {
        id: "val_9002",
        finding: "Missing tenant check",
        decision: "accepted",
        reason: "Changed route bypasses existing requireTenantPayment helper.",
        confidence: 0.91
      },
      {
        id: "val_9003",
        finding: "Logger includes request body",
        decision: "rejected",
        reason: "The raw body is redacted by middleware before this call site.",
        confidence: 0.39
      },
      {
        id: "val_9004",
        finding: "Repeated audit migration warning",
        decision: "deduplicated",
        reason: "Merged with migration audit metadata finding.",
        confidence: 0.84
      }
    ],
    modelCalls: [
      {
        id: "call_5101",
        model: "gpt-4.1",
        purpose: "diff-analysis",
        inputTokens: 18420,
        outputTokens: 1320,
        costUsd: 0.34,
        latencyMs: 21840
      },
      {
        id: "call_5102",
        model: "gpt-4.1-mini",
        purpose: "validator",
        inputTokens: 8140,
        outputTokens: 760,
        costUsd: 0.12,
        latencyMs: 10860
      },
      {
        id: "call_5103",
        model: "gpt-4.1-mini",
        purpose: "dedupe-and-comment",
        inputTokens: 4210,
        outputTokens: 510,
        costUsd: 0.12,
        latencyMs: 7340
      }
    ]
  },
  {
    id: "rvw_1041",
    createdAt: "2026-06-19T18:17:00.000Z",
    repo: "northstar/api",
    prNumber: 117,
    title: "Add audit export endpoint",
    status: "validating",
    findingsCount: 1,
    candidatesCount: 4,
    costUsd: 0.31,
    latencySeconds: 44,
    confidenceThreshold: 0.84,
    githubCommentStatus: "pending",
    findings: [
      {
        id: "fnd_704",
        title: "Audit export does not enforce organization scope",
        severity: "high",
        file: "apps/api/src/audit/export.ts",
        line: 66,
        confidence: 0.89,
        status: "pending",
        summary: "The query accepts an org id parameter but does not compare it with the authenticated session."
      }
    ],
    validatorDecisions: [
      {
        id: "val_9005",
        finding: "Organization scope missing",
        decision: "accepted",
        reason: "Authorization helper is absent from the new handler.",
        confidence: 0.89
      }
    ],
    modelCalls: [
      {
        id: "call_5104",
        model: "gpt-4.1",
        purpose: "diff-analysis",
        inputTokens: 12880,
        outputTokens: 980,
        costUsd: 0.21,
        latencyMs: 18760
      },
      {
        id: "call_5105",
        model: "gpt-4.1-mini",
        purpose: "validator",
        inputTokens: 5140,
        outputTokens: 420,
        costUsd: 0.1,
        latencyMs: 7920
      }
    ]
  },
  {
    id: "rvw_1040",
    createdAt: "2026-06-19T16:04:00.000Z",
    repo: "atlas/web",
    prNumber: 903,
    title: "Refactor billing settings form",
    status: "completed",
    findingsCount: 0,
    candidatesCount: 5,
    costUsd: 0.22,
    latencySeconds: 39,
    confidenceThreshold: 0.86,
    githubCommentStatus: "skipped",
    findings: [],
    validatorDecisions: [
      {
        id: "val_9006",
        finding: "Style-only form extraction",
        decision: "rejected",
        reason: "No behavioral regression was supported by the changed code.",
        confidence: 0.27
      },
      {
        id: "val_9007",
        finding: "Possible missing loading state",
        decision: "rejected",
        reason: "Existing submit button state is preserved through the wrapper.",
        confidence: 0.33
      }
    ],
    modelCalls: [
      {
        id: "call_5106",
        model: "gpt-4.1-mini",
        purpose: "diff-analysis",
        inputTokens: 9320,
        outputTokens: 640,
        costUsd: 0.14,
        latencyMs: 15420
      },
      {
        id: "call_5107",
        model: "gpt-4.1-mini",
        purpose: "validator",
        inputTokens: 3760,
        outputTokens: 360,
        costUsd: 0.08,
        latencyMs: 6380
      }
    ]
  },
  {
    id: "rvw_1039",
    createdAt: "2026-06-18T21:28:00.000Z",
    repo: "orbit/admin",
    prNumber: 264,
    title: "Queue tenant deletion workflow",
    status: "failed",
    findingsCount: 0,
    candidatesCount: 2,
    costUsd: 0.18,
    latencySeconds: 57,
    confidenceThreshold: 0.88,
    githubCommentStatus: "failed",
    findings: [],
    validatorDecisions: [
      {
        id: "val_9008",
        finding: "Deletion worker may skip retry",
        decision: "rejected",
        reason: "Worker code was outside the pull request diff.",
        confidence: 0.36
      }
    ],
    modelCalls: [
      {
        id: "call_5108",
        model: "gpt-4.1-mini",
        purpose: "diff-analysis",
        inputTokens: 7440,
        outputTokens: 510,
        costUsd: 0.18,
        latencyMs: 17210
      }
    ]
  }
];

export const repositories: RepositorySettings[] = [
  {
    id: "repo_001",
    repo: "acme/payments",
    installation: "Acme Engineering",
    enabled: true,
    confidenceThreshold: 0.82,
    maxFindingsPerPr: 5,
    rulesPath: ".diffguard-rules.md",
    lastReviewedAt: "2026-06-19T19:42:00.000Z"
  },
  {
    id: "repo_002",
    repo: "northstar/api",
    installation: "Northstar Platform",
    enabled: true,
    confidenceThreshold: 0.84,
    maxFindingsPerPr: 4,
    rulesPath: ".diffguard-rules.md",
    lastReviewedAt: "2026-06-19T18:17:00.000Z"
  },
  {
    id: "repo_003",
    repo: "atlas/web",
    installation: "Atlas Product",
    enabled: true,
    confidenceThreshold: 0.86,
    maxFindingsPerPr: 3,
    rulesPath: ".diffguard-rules.md",
    lastReviewedAt: "2026-06-19T16:04:00.000Z"
  },
  {
    id: "repo_004",
    repo: "orbit/admin",
    installation: "Orbit Internal Tools",
    enabled: false,
    confidenceThreshold: 0.88,
    maxFindingsPerPr: 2,
    rulesPath: ".diffguard-rules.md",
    lastReviewedAt: "2026-06-18T21:28:00.000Z"
  }
];

export const evalRuns: EvalRun[] = [
  {
    id: "eval_20260619",
    name: "payments-security-v7",
    createdAt: "2026-06-19T22:00:00.000Z",
    precision: 0.91,
    recall: 0.76,
    falsePositives: 4,
    falseNegatives: 9,
    costUsd: 12.48,
    cases: 128
  },
  {
    id: "eval_20260618",
    name: "api-contracts-v4",
    createdAt: "2026-06-18T22:00:00.000Z",
    precision: 0.88,
    recall: 0.73,
    falsePositives: 6,
    falseNegatives: 11,
    costUsd: 10.92,
    cases: 112
  },
  {
    id: "eval_20260617",
    name: "authz-regressions-v3",
    createdAt: "2026-06-17T22:00:00.000Z",
    precision: 0.93,
    recall: 0.71,
    falsePositives: 3,
    falseNegatives: 12,
    costUsd: 11.36,
    cases: 120
  }
];

export const reviewTrend = [
  { day: "Jun 15", prs: 28, findings: 51, rejected: 24, cost: 19.28, latency: 46 },
  { day: "Jun 16", prs: 31, findings: 58, rejected: 29, cost: 22.42, latency: 49 },
  { day: "Jun 17", prs: 27, findings: 44, rejected: 27, cost: 18.91, latency: 45 },
  { day: "Jun 18", prs: 35, findings: 72, rejected: 34, cost: 25.54, latency: 52 },
  { day: "Jun 19", prs: 33, findings: 65, rejected: 31, cost: 23.87, latency: 48 }
];

export function getDashboardMetrics(): DashboardMetrics {
  const totalValidatorDecisions =
    overviewSnapshot.validatorAccepted + overviewSnapshot.validatorRejected;
  const latencyTotal = overviewSnapshot.latencySamplesSeconds.reduce((total, item) => total + item, 0);

  return {
    totalPrsReviewed: overviewSnapshot.totalPrsReviewed,
    findingsPosted: overviewSnapshot.validatorAccepted,
    resolvedFindings: overviewSnapshot.resolvedFindings,
    unresolvedFindings: overviewSnapshot.unresolvedFindings,
    falsePositiveFindings: overviewSnapshot.falsePositiveFindings,
    unknownFindings: overviewSnapshot.unknownFindings,
    validatorRejectionRate: overviewSnapshot.validatorRejected / totalValidatorDecisions,
    estimatedResolutionRate: overviewSnapshot.resolvedFindings / overviewSnapshot.validatorAccepted,
    totalCostUsd: overviewSnapshot.totalCostUsd,
    averageLatencySeconds: Math.round(latencyTotal / overviewSnapshot.latencySamplesSeconds.length)
  };
}

export function getReviewRuns(): ReviewRun[] {
  return [...reviewRuns].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getReviewRunById(id: string): ReviewRun | undefined {
  return reviewRuns.find((run) => run.id === id);
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}m ${remainingSeconds}s`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
