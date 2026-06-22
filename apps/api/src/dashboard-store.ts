export type ReviewRunStatus =
  | "queued"
  | "analyzing"
  | "validating"
  | "completed"
  | "failed"
  | "skipped";

export type ValidatorDecision = "accepted" | "rejected" | "deduplicated";

export type GitHubCommentStatus = "posted" | "skipped" | "pending" | "failed";

export type FindingSeverity = "critical" | "high" | "medium";

export type DashboardFinding = {
  id: string;
  title: string;
  severity: FindingSeverity;
  file: string;
  line: number;
  confidence: number;
  status: GitHubCommentStatus;
  summary: string;
};

export type DashboardReviewRun = {
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
  findings: DashboardFinding[];
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
};

export type DashboardRepository = {
  id: string;
  repo: string;
  installation: string;
  enabled: boolean;
  confidenceThreshold: number;
  maxFindingsPerPr: number;
  rulesPath: string;
  lastReviewedAt: string;
};

export type DashboardEvalSummary = {
  id: string;
  name: string;
  createdAt: string;
  precision: number;
  recall: number;
  falsePositives: number;
  falseNegatives: number;
  costUsd: number;
  cases: number;
};

export type DashboardMetrics = {
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
};

export type ReviewTrendPoint = {
  day: string;
  prs: number;
  findings: number;
  rejected: number;
  cost: number;
  latency: number;
};

export type DashboardOverview = {
  metrics: DashboardMetrics;
  reviewTrend: ReviewTrendPoint[];
};

export type DashboardStore = {
  getOverview(): Promise<DashboardOverview>;
  listReviewRuns(): Promise<DashboardReviewRun[]>;
  getReviewRun(id: string): Promise<DashboardReviewRun | null>;
  listRepositories(): Promise<DashboardRepository[]>;
  listFindings(): Promise<DashboardFinding[]>;
  listEvalSummaries(): Promise<DashboardEvalSummary[]>;
};

type DecimalLike = number | string | { toString(): string } | null | undefined;

type RepositoryRecord = {
  id: string;
  owner: string;
  name: string;
  githubInstallationId: string | null;
  rulesPath: string;
  pullRequests?: Array<{
    reviewRuns?: Array<{
      createdAt: Date;
    }>;
  }>;
};

type PullRequestRecord = {
  number: number;
  title: string;
  repository: {
    owner: string;
    name: string;
  };
};

type FindingRecord = {
  id: string;
  title: string;
  summary: string;
  severity: string;
  confidence: DecimalLike;
  filePath: string;
  line: number;
  status: string;
};

type ModelCallRecord = {
  id: string;
  provider: string;
  modelName: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: DecimalLike;
  latencyMs: number;
};

type ValidatorDecisionRecord = {
  id: string;
  confidence: DecimalLike;
  decision: string;
  findingTitle: string;
  reason: string;
};

type ReviewRunRecord = {
  id: string;
  status: string;
  findingsDetected: number;
  findingsPosted: number;
  validatorRejectionRate: DecimalLike;
  estimatedFalsePositives: number;
  resolvedFindings: number;
  totalCostUsd: DecimalLike;
  latencyMs: number | null;
  createdAt: Date;
  pullRequest: PullRequestRecord;
  findings: FindingRecord[];
  modelCalls: ModelCallRecord[];
  validatorDecisions?: ValidatorDecisionRecord[];
};

type EvalRunRecord = {
  id: string;
  name: string;
  createdAt: Date;
  precision: DecimalLike;
  recall: DecimalLike;
  falsePositiveCount: number;
  falseNegativeCount: number;
  costUsd: DecimalLike;
  caseCount: number;
};

type DashboardDatabaseClient = {
  evalRun: {
    findMany(args: unknown): Promise<EvalRunRecord[]>;
  };
  repository: {
    findMany(args: unknown): Promise<RepositoryRecord[]>;
  };
  reviewRun: {
    findMany(args: unknown): Promise<ReviewRunRecord[]>;
    findUnique(args: unknown): Promise<ReviewRunRecord | null>;
  };
  finding: {
    findMany(args: unknown): Promise<FindingRecord[]>;
  };
};

export function createPrismaDashboardStore(database: DashboardDatabaseClient): DashboardStore {
  return {
    async getOverview() {
      const reviewRuns = await database.reviewRun.findMany({
        include: reviewRunInclude,
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      return toOverview(reviewRuns);
    },
    async getReviewRun(id) {
      const reviewRun = await database.reviewRun.findUnique({
        include: reviewRunInclude,
        where: { id },
      });

      return reviewRun === null ? null : toDashboardReviewRun(reviewRun);
    },
    async listEvalSummaries() {
      const evalRuns = await database.evalRun.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      return evalRuns.map(toDashboardEvalSummary);
    },
    async listFindings() {
      const findings = await database.finding.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      return findings.map(toDashboardFinding);
    },
    async listRepositories() {
      const repositories = await database.repository.findMany({
        include: {
          pullRequests: {
            include: {
              reviewRuns: {
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
        orderBy: [{ owner: "asc" }, { name: "asc" }],
      });

      return repositories.map(toDashboardRepository);
    },
    async listReviewRuns() {
      const reviewRuns = await database.reviewRun.findMany({
        include: reviewRunInclude,
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      return reviewRuns.map(toDashboardReviewRun);
    },
  };
}

const reviewRunInclude = {
  findings: { orderBy: { createdAt: "asc" } },
  modelCalls: { orderBy: { createdAt: "asc" } },
  pullRequest: {
    include: {
      repository: true,
    },
  },
  validatorDecisions: { orderBy: { createdAt: "asc" } },
};

function toOverview(reviewRuns: ReviewRunRecord[]): DashboardOverview {
  const completedRuns = reviewRuns.filter((run) => run.status === "COMPLETED");
  const reviewedRuns = completedRuns.length === 0 ? reviewRuns : completedRuns;
  const findingsPosted = sum(reviewedRuns, (run) => run.findingsPosted);
  const resolvedFindings = sum(reviewedRuns, (run) => run.resolvedFindings);
  const falsePositiveFindings = sum(reviewedRuns, (run) => run.estimatedFalsePositives);
  const totalDetected = sum(reviewedRuns, (run) => run.findingsDetected);
  const totalCostUsd = roundCurrency(sum(reviewedRuns, (run) => toNumber(run.totalCostUsd)));
  const latencySamples = reviewedRuns
    .map((run) => run.latencyMs)
    .filter((latency): latency is number => latency !== null);
  const validatorRates = reviewedRuns
    .map((run) => run.validatorRejectionRate)
    .filter((rate): rate is Exclude<DecimalLike, null | undefined> => rate !== null && rate !== undefined)
    .map(toNumber);
  const unresolvedFindings = Math.max(findingsPosted - resolvedFindings - falsePositiveFindings, 0);
  const unknownFindings = Math.max(totalDetected - findingsPosted - falsePositiveFindings, 0);

  return {
    metrics: {
      averageLatencySeconds:
        latencySamples.length === 0
          ? 0
          : Math.round(sum(latencySamples, (latency) => latency) / latencySamples.length / 1000),
      estimatedResolutionRate: findingsPosted === 0 ? 0 : resolvedFindings / findingsPosted,
      falsePositiveFindings,
      findingsPosted,
      resolvedFindings,
      totalCostUsd,
      totalPrsReviewed: reviewedRuns.length,
      unknownFindings,
      unresolvedFindings,
      validatorRejectionRate:
        validatorRates.length === 0
          ? 0
          : sum(validatorRates, (rate) => rate) / validatorRates.length,
    },
    reviewTrend: toReviewTrend(reviewedRuns),
  };
}

function toReviewTrend(reviewRuns: ReviewRunRecord[]): ReviewTrendPoint[] {
  const byDay = new Map<string, ReviewTrendPoint>();
  const sortedRuns = [...reviewRuns].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const run of sortedRuns) {
    const day = formatDay(run.createdAt);
    const existing =
      byDay.get(day) ??
      ({
        cost: 0,
        day,
        findings: 0,
        latency: 0,
        prs: 0,
        rejected: 0,
      } satisfies ReviewTrendPoint);
    const rejected = Math.max(run.findingsDetected - run.findingsPosted, 0);

    existing.cost = roundCurrency(existing.cost + toNumber(run.totalCostUsd));
    existing.findings += run.findingsPosted;
    existing.latency += run.latencyMs === null ? 0 : Math.round(run.latencyMs / 1000);
    existing.prs += 1;
    existing.rejected += rejected;
    byDay.set(day, existing);
  }

  return [...byDay.values()].slice(-14).map((point) => ({
    ...point,
    latency: point.prs === 0 ? 0 : Math.round(point.latency / point.prs),
  }));
}

function toDashboardReviewRun(reviewRun: ReviewRunRecord): DashboardReviewRun {
  const findings = reviewRun.findings.map(toDashboardFinding);

  return {
    candidatesCount: Math.max(reviewRun.findingsDetected, findings.length),
    confidenceThreshold: 0.8,
    costUsd: roundCurrency(toNumber(reviewRun.totalCostUsd)),
    createdAt: reviewRun.createdAt.toISOString(),
    findings,
    findingsCount: reviewRun.findingsPosted,
    githubCommentStatus: toGitHubCommentStatus(reviewRun),
    id: reviewRun.id,
    latencySeconds: reviewRun.latencyMs === null ? 0 : Math.round(reviewRun.latencyMs / 1000),
    modelCalls: reviewRun.modelCalls.map(toDashboardModelCall),
    prNumber: reviewRun.pullRequest.number,
    repo: `${reviewRun.pullRequest.repository.owner}/${reviewRun.pullRequest.repository.name}`,
    status: toReviewRunStatus(reviewRun.status),
    title: reviewRun.pullRequest.title,
    validatorDecisions: toDashboardValidatorDecisions(reviewRun),
  };
}

function toDashboardFinding(finding: FindingRecord): DashboardFinding {
  return {
    confidence: toNumber(finding.confidence),
    file: finding.filePath,
    id: finding.id,
    line: finding.line,
    severity: toFindingSeverity(finding.severity),
    status: toFindingStatus(finding.status),
    summary: finding.summary,
    title: finding.title,
  };
}

function toDashboardModelCall(modelCall: ModelCallRecord): DashboardReviewRun["modelCalls"][number] {
  return {
    costUsd: roundCurrency(toNumber(modelCall.costUsd)),
    id: modelCall.id,
    inputTokens: modelCall.inputTokens,
    latencyMs: modelCall.latencyMs,
    model: modelCall.modelName,
    outputTokens: modelCall.outputTokens,
    purpose: `${modelCall.provider}:${modelCall.promptVersion}`,
  };
}

function toDashboardValidatorDecisions(
  reviewRun: ReviewRunRecord,
): DashboardReviewRun["validatorDecisions"] {
  if ((reviewRun.validatorDecisions?.length ?? 0) > 0) {
    return (reviewRun.validatorDecisions ?? []).map((decision) => ({
      confidence: toNumber(decision.confidence),
      decision: toValidatorDecision(decision.decision),
      finding: decision.findingTitle,
      id: decision.id,
      reason: decision.reason,
    }));
  }

  return reviewRun.findings.map((finding) => ({
    confidence: toNumber(finding.confidence),
    decision: "accepted",
    finding: finding.title,
    id: `${finding.id}:accepted`,
    reason: "Validated finding retained for dashboard reporting.",
  }));
}

function toValidatorDecision(decision: string): ValidatorDecision {
  switch (decision) {
    case "rejected":
      return "rejected";
    case "deduplicated":
      return "deduplicated";
    case "accepted":
    default:
      return "accepted";
  }
}

function toDashboardRepository(repository: RepositoryRecord): DashboardRepository {
  const lastReviewedAt =
    repository.pullRequests
      ?.flatMap((pullRequest) => pullRequest.reviewRuns ?? [])
      .map((reviewRun) => reviewRun.createdAt)
      .sort((a, b) => b.getTime() - a.getTime())[0]
      ?.toISOString() ?? "";

  return {
    confidenceThreshold: 0.8,
    enabled: repository.githubInstallationId !== null,
    id: repository.id,
    installation: repository.githubInstallationId ?? "Not installed",
    lastReviewedAt,
    maxFindingsPerPr: 5,
    repo: `${repository.owner}/${repository.name}`,
    rulesPath: repository.rulesPath,
  };
}

function toDashboardEvalSummary(evalRun: EvalRunRecord): DashboardEvalSummary {
  return {
    cases: evalRun.caseCount,
    costUsd: roundCurrency(toNumber(evalRun.costUsd)),
    createdAt: evalRun.createdAt.toISOString(),
    falseNegatives: evalRun.falseNegativeCount,
    falsePositives: evalRun.falsePositiveCount,
    id: evalRun.id,
    name: evalRun.name,
    precision: toNumber(evalRun.precision),
    recall: toNumber(evalRun.recall),
  };
}

function toReviewRunStatus(status: string): ReviewRunStatus {
  switch (status) {
    case "QUEUED":
      return "queued";
    case "RUNNING":
      return "analyzing";
    case "COMPLETED":
      return "completed";
    case "SKIPPED":
      return "skipped";
    case "FAILED":
    case "CANCELED":
    default:
      return "failed";
  }
}

function toFindingSeverity(severity: string): FindingSeverity {
  switch (severity) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "LOW":
    case "MEDIUM":
    default:
      return "medium";
  }
}

function toFindingStatus(status: string): GitHubCommentStatus {
  switch (status) {
    case "POSTED":
      return "posted";
    case "VALIDATED":
      return "pending";
    case "FALSE_POSITIVE":
    case "DISMISSED":
      return "skipped";
    default:
      return "pending";
  }
}

function toGitHubCommentStatus(reviewRun: ReviewRunRecord): GitHubCommentStatus {
  if (reviewRun.status === "FAILED" || reviewRun.status === "CANCELED") {
    return "failed";
  }

  if (reviewRun.status === "SKIPPED") {
    return "skipped";
  }

  if (reviewRun.findingsPosted > 0) {
    return "posted";
  }

  if (reviewRun.status === "COMPLETED") {
    return "skipped";
  }

  return "pending";
}

function toNumber(value: DecimalLike): number {
  if (value === null || value === undefined) {
    return 0;
  }

  return typeof value === "number" ? value : Number(value.toString());
}

function sum<T>(items: T[], getValue: (item: T) => number): number {
  return items.reduce((total, item) => total + getValue(item), 0);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}
