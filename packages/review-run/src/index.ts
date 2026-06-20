import {
  type DiffGuardGitHubClient,
  type GitHubResult,
  type PullRequestFile,
  type PullRequestRef,
  type ReviewCommentInput,
} from "@diffguard/github";
import type { RejectedFinding, ReviewResult } from "@diffguard/reviewer";
import { parseUnifiedDiff, type ReviewFinding } from "@diffguard/shared";

export type PostedReviewFinding = {
  dedupeKey: string;
  githubCommentId: string;
  line: number;
  path: string;
};

export type StoreReviewRunInput = {
  model?: string;
  posted: boolean;
  postedFindings?: PostedReviewFinding[];
  result: ReviewResult;
};

export type ReviewSummaryOptions = {
  dryRun: boolean;
  maxFindings?: number;
  minConfidence: number;
  model?: string;
};

export type FinalizeReviewRunInput = {
  dryRun: boolean;
  githubClient: DiffGuardGitHubClient;
  loadPostedFindingDedupeKeys?: (input: PullRequestRef) => Promise<Set<string>>;
  maxFindings?: number;
  minConfidence?: number;
  model?: string;
  ref: PullRequestRef;
  result: ReviewResult;
  storeReviewRun?: (input: StoreReviewRunInput) => Promise<void>;
};

export type FinalizeReviewRunResult = {
  posted: boolean;
  postedFindings: PostedReviewFinding[];
  result: ReviewResult;
  summary: string;
};

export type PrismaRepository = {
  id: string;
};

export type PrismaPullRequest = {
  id: string;
};

export type PrismaReviewRun = {
  id: string;
};

export type PrismaClientLike = {
  $disconnect(): Promise<void>;
  finding: {
    createMany(input: {
      data: Array<{
        category: string;
        confidence: number;
        dedupeKey: string;
        evidence: string;
        filePath: string;
        githubCommentId?: string;
        line: number;
        relatedRuleIds: string[];
        reviewRunId: string;
        severity: string;
        side: string;
        status: string;
        suggestedFix?: string;
        summary: string;
        title: string;
        whyItMatters: string;
      }>;
      skipDuplicates: boolean;
    }): Promise<unknown>;
    findMany(input: {
      select: {
        dedupeKey: true;
      };
      where: {
        githubCommentId: {
          not: null;
        };
        reviewRun: {
          pullRequest: {
            number: number;
            repository: {
              name: string;
              owner: string;
            };
          };
        };
      };
    }): Promise<Array<{ dedupeKey: string }>>;
  };
  pullRequest: {
    upsert(input: {
      create: {
        authorLogin?: string;
        baseSha: string;
        headSha: string;
        number: number;
        repositoryId: string;
        status: string;
        title: string;
      };
      update: {
        authorLogin?: string;
        baseSha: string;
        headSha: string;
        status: string;
        title: string;
      };
      where: {
        repositoryId_number: {
          number: number;
          repositoryId: string;
        };
      };
    }): Promise<PrismaPullRequest>;
  };
  repository: {
    upsert(input: {
      create: {
        name: string;
        owner: string;
      };
      update: Record<string, never>;
      where: {
        owner_name: {
          name: string;
          owner: string;
        };
      };
    }): Promise<PrismaRepository>;
  };
  reviewRun: {
    create(input: {
      data: {
        completedAt: Date;
        findingsDetected: number;
        findingsPosted: number;
        latencyMs: number;
        pullRequestId: string;
        startedAt: Date;
        status: string;
        validatorRejectionRate?: number;
      };
    }): Promise<PrismaReviewRun>;
  };
};

export async function finalizeReviewRun(
  input: FinalizeReviewRunInput,
): Promise<FinalizeReviewRunResult> {
  const minConfidence = input.minConfidence ?? 0.7;
  const postedDedupeKeys =
    input.dryRun || input.loadPostedFindingDedupeKeys === undefined
      ? new Set<string>()
      : await input.loadPostedFindingDedupeKeys(input.ref);
  const result = limitFindings(
    filterPreviouslyPostedFindings(input.result, postedDedupeKeys),
    input.maxFindings,
  );
  const summaryOptions = {
    dryRun: input.dryRun,
    maxFindings: input.maxFindings,
    minConfidence,
    model: input.model,
  };
  const summary = buildMarkdownSummary(result, summaryOptions);
  let posted = false;
  let postedFindings: PostedReviewFinding[] = [];

  if (!input.dryRun) {
    const postingResult = await postReviewFindings({
      githubClient: input.githubClient,
      ref: input.ref,
      result,
      summary,
      summaryOptions,
    });

    posted = postingResult.posted;
    postedFindings = postingResult.postedFindings;
  }

  await input.storeReviewRun?.({
    model: input.model,
    posted,
    postedFindings,
    result,
  });

  return {
    posted,
    postedFindings,
    result,
    summary,
  };
}

export function buildMarkdownSummary(
  result: ReviewResult,
  options: ReviewSummaryOptions,
): string {
  const findings =
    options.maxFindings === undefined
      ? result.findings
      : result.findings.slice(0, options.maxFindings);
  const lines = [
    "## DiffGuard-AI Review",
    "",
    `Pull request: #${result.pullRequest.number} ${result.pullRequest.title}`,
    `Dry run: ${options.dryRun ? "yes" : "no"}`,
    `Minimum confidence: ${formatConfidence(options.minConfidence)}`,
    `Model: ${options.model ?? "default"}`,
    `Rules: ${result.context.rules.path} ${result.context.rules.found ? "found" : "not found"}`,
    `Findings: ${findings.length}`,
    `Rejected candidates: ${result.rejectedFindings.length}`,
    "",
  ];

  if (findings.length === 0) {
    lines.push("No high-confidence findings met the posting threshold.");
  } else {
    lines.push("### Findings", "");
    findings.forEach((finding, index) => {
      lines.push(formatFinding(finding, index + 1), "");
    });
  }

  if (options.maxFindings !== undefined) {
    lines.push(`Limited to the top ${options.maxFindings} finding(s).`);
  }

  return lines.join("\n").trim();
}

export async function postReviewFindings(input: {
  githubClient: DiffGuardGitHubClient;
  ref: PullRequestRef;
  result: ReviewResult;
  summary: string;
  summaryOptions: ReviewSummaryOptions;
}): Promise<{ posted: boolean; postedFindings: PostedReviewFinding[] }> {
  const planned = planReviewPosting(input.result);
  const postedFindings: PostedReviewFinding[] = [];

  if (planned.inline.length > 0) {
    const review = unwrapGitHubResult(
      await input.githubClient.createPullRequestReview({
        body: input.summary,
        comments: planned.inline.map((comment) => comment.comment),
        event: "COMMENT",
        ref: input.ref,
      }),
      "Failed to create pull request review.",
    );
    const reviewComments = unwrapGitHubResult(
      await input.githubClient.listPullRequestReviewComments({
        ref: input.ref,
        reviewId: review.id,
      }),
      "Failed to list pull request review comments.",
    );

    postedFindings.push(...matchPostedInlineComments(planned.inline, reviewComments));
  }

  if (planned.fallback.length > 0) {
    const fallbackSummary = buildMarkdownSummary(
      {
        ...input.result,
        findings: planned.fallback.map((plannedFinding) => plannedFinding.finding),
      },
      input.summaryOptions,
    );
    const comment = unwrapGitHubResult(
      await input.githubClient.postPullRequestComment({
        body: fallbackSummary,
        ref: input.ref,
      }),
      "Failed to post pull request summary comment.",
    );

    postedFindings.push(
      ...planned.fallback.map((plannedFinding) => ({
        dedupeKey: buildFindingDedupeKey(plannedFinding.finding),
        githubCommentId: String(comment.id),
        line: plannedFinding.finding.line,
        path: plannedFinding.finding.filePath,
      })),
    );
  }

  return {
    posted: planned.inline.length > 0 || planned.fallback.length > 0,
    postedFindings,
  };
}

export function planReviewPosting(result: ReviewResult): {
  fallback: Array<{ finding: ReviewFinding }>;
  inline: Array<{ comment: ReviewCommentInput; finding: ReviewFinding }>;
} {
  const fallback: Array<{ finding: ReviewFinding }> = [];
  const inline: Array<{ comment: ReviewCommentInput; finding: ReviewFinding }> = [];

  for (const finding of result.findings) {
    const mapped = mapFindingToReviewComment(result.context.files, finding);

    if (mapped.kind === "mapped") {
      inline.push({
        comment: {
          body: finding.improvedComment ?? finding.summary,
          line: mapped.line,
          path: mapped.path,
          side: mapped.side,
        },
        finding,
      });
      continue;
    }

    if (mapped.kind === "unmapped") {
      fallback.push({ finding });
    }
  }

  return { fallback, inline };
}

export async function storeReviewRunInDatabase(input: StoreReviewRunInput & {
  database?: PrismaClientLike;
}): Promise<void> {
  const database = input.database ?? (await createDefaultDatabaseClient());

  try {
    const repository = await database.repository.upsert({
      create: {
        name: input.result.context.ref.repo,
        owner: input.result.context.ref.owner,
      },
      update: {},
      where: {
        owner_name: {
          name: input.result.context.ref.repo,
          owner: input.result.context.ref.owner,
        },
      },
    });
    const pullRequest = await database.pullRequest.upsert({
      create: {
        ...(input.result.pullRequest.authorLogin === undefined
          ? {}
          : { authorLogin: input.result.pullRequest.authorLogin }),
        baseSha: input.result.pullRequest.baseSha,
        headSha: input.result.pullRequest.headSha,
        number: input.result.pullRequest.number,
        repositoryId: repository.id,
        status: mapPullRequestStatus(input.result.pullRequest.state),
        title: input.result.pullRequest.title,
      },
      update: {
        ...(input.result.pullRequest.authorLogin === undefined
          ? {}
          : { authorLogin: input.result.pullRequest.authorLogin }),
        baseSha: input.result.pullRequest.baseSha,
        headSha: input.result.pullRequest.headSha,
        status: mapPullRequestStatus(input.result.pullRequest.state),
        title: input.result.pullRequest.title,
      },
      where: {
        repositoryId_number: {
          number: input.result.pullRequest.number,
          repositoryId: repository.id,
        },
      },
    });
    const startedAt = readFirstStartedAt(input.result);
    const completedAt = readLastCompletedAt(input.result);
    const reviewRun = await database.reviewRun.create({
      data: {
        completedAt,
        findingsDetected: input.result.findings.length + input.result.rejectedFindings.length,
        findingsPosted: input.posted ? input.result.findings.length : 0,
        latencyMs: input.result.timings.reduce((total, timing) => total + timing.durationMs, 0),
        pullRequestId: pullRequest.id,
        startedAt,
        status: "COMPLETED",
        validatorRejectionRate: calculateValidatorRejectionRate(input.result),
      },
    });

    if (input.result.findings.length > 0) {
      const postedFindingByDedupeKey = new Map(
        (input.postedFindings ?? []).map((postedFinding) => [
          postedFinding.dedupeKey,
          postedFinding,
        ]),
      );

      await database.finding.createMany({
        data: input.result.findings.map((finding) => {
          const dedupeKey = buildFindingDedupeKey(finding);
          const postedFinding = postedFindingByDedupeKey.get(dedupeKey);

          return {
            category: mapEnumValue(finding.category),
            confidence: finding.confidence,
            dedupeKey,
            evidence: finding.evidence,
            filePath: finding.filePath,
            ...(postedFinding === undefined
              ? {}
              : { githubCommentId: postedFinding.githubCommentId }),
            line: finding.line,
            relatedRuleIds: finding.relatedRuleIds,
            reviewRunId: reviewRun.id,
            severity: mapEnumValue(finding.severity),
            side: finding.side,
            status: postedFinding === undefined ? "VALIDATED" : "POSTED",
            suggestedFix: finding.suggestedFix,
            summary: finding.summary,
            title: finding.title,
            whyItMatters: finding.whyItMatters,
          };
        }),
        skipDuplicates: true,
      });
    }
  } finally {
    await database.$disconnect();
  }
}

export async function loadPostedFindingDedupeKeysFromDatabase(input: {
  database?: PrismaClientLike;
  ref: PullRequestRef;
}): Promise<Set<string>> {
  const database = input.database ?? (await createDefaultDatabaseClient());

  try {
    const findings = await database.finding.findMany({
      select: {
        dedupeKey: true,
      },
      where: {
        githubCommentId: {
          not: null,
        },
        reviewRun: {
          pullRequest: {
            number: input.ref.number,
            repository: {
              name: input.ref.repo,
              owner: input.ref.owner,
            },
          },
        },
      },
    });

    return new Set(findings.map((finding) => finding.dedupeKey));
  } finally {
    await database.$disconnect();
  }
}

export function filterPreviouslyPostedFindings(
  result: ReviewResult,
  postedDedupeKeys: Set<string>,
): ReviewResult {
  if (postedDedupeKeys.size === 0) {
    return result;
  }

  return {
    ...result,
    findings: result.findings.filter(
      (finding) => !postedDedupeKeys.has(buildFindingDedupeKey(finding)),
    ),
  };
}

export function limitFindings(result: ReviewResult, maxFindings: number | undefined): ReviewResult {
  if (maxFindings === undefined || result.findings.length <= maxFindings) {
    return result;
  }

  return {
    ...result,
    findings: result.findings.slice(0, maxFindings),
  };
}

export function buildFindingDedupeKey(finding: ReviewFinding): string {
  return [finding.filePath, finding.line, finding.category, normalizeTitle(finding.title)].join(
    ":",
  );
}

async function createDefaultDatabaseClient(): Promise<PrismaClientLike> {
  const { createDatabaseClient } = await import("@diffguard/database");

  return createDatabaseClient() as unknown as PrismaClientLike;
}

function mapFindingToReviewComment(
  files: PullRequestFile[],
  finding: ReviewFinding,
):
  | {
      kind: "deleted";
    }
  | {
      kind: "mapped";
      line: number;
      path: string;
      side: "LEFT" | "RIGHT";
    }
  | {
      kind: "unmapped";
    } {
  const file = files.find(
    (changedFile) =>
      changedFile.filename === finding.filePath || changedFile.previousFilename === finding.filePath,
  );

  if (file === undefined || file.patch === undefined) {
    return { kind: "unmapped" };
  }

  if (file.status === "removed" || file.status === "deleted") {
    return { kind: "deleted" };
  }

  const diffLines = parseUnifiedDiff(file.patch).files.flatMap((parsedFile) =>
    parsedFile.hunks.flatMap((hunk) => hunk.lines),
  );
  const lineIsInDiff = diffLines.some((line) => {
    if (finding.side === "RIGHT") {
      return line.newLine === finding.line && line.kind !== "delete";
    }

    return line.oldLine === finding.line && line.kind !== "add";
  });

  if (!lineIsInDiff) {
    return { kind: "unmapped" };
  }

  return {
    kind: "mapped",
    line: finding.line,
    path: file.filename,
    side: finding.side,
  };
}

function matchPostedInlineComments(
  plannedComments: Array<{ comment: ReviewCommentInput; finding: ReviewFinding }>,
  reviewComments: Array<{
    body?: string;
    id: number;
    line?: number;
    path: string;
    side?: "LEFT" | "RIGHT";
  }>,
): PostedReviewFinding[] {
  const matchedCommentIndexes = new Set<number>();
  const postedFindings: PostedReviewFinding[] = [];

  for (const planned of plannedComments) {
    const commentIndex = reviewComments.findIndex(
      (comment, index) =>
        !matchedCommentIndexes.has(index) &&
        comment.path === planned.comment.path &&
        comment.line === planned.comment.line &&
        comment.side === planned.comment.side &&
        comment.body === planned.comment.body,
    );

    if (commentIndex === -1) {
      continue;
    }

    const comment = reviewComments[commentIndex];
    if (comment === undefined) {
      continue;
    }

    matchedCommentIndexes.add(commentIndex);
    postedFindings.push({
      dedupeKey: buildFindingDedupeKey(planned.finding),
      githubCommentId: String(comment.id),
      line: planned.finding.line,
      path: planned.comment.path,
    });
  }

  return postedFindings;
}

function formatFinding(finding: ReviewFinding, index: number): string {
  const comment = finding.improvedComment ?? finding.summary;

  return [
    `${index}. **${finding.title}**`,
    `   - Location: \`${finding.filePath}:${finding.line}\``,
    `   - Severity: ${finding.severity}`,
    `   - Category: ${finding.category}`,
    `   - Confidence: ${formatConfidence(finding.confidence)}`,
    `   - Comment: ${comment}`,
  ].join("\n");
}

function formatConfidence(confidence: number): string {
  return confidence.toFixed(2);
}

function unwrapGitHubResult<T>(result: GitHubResult<T>, message: string): T {
  if (result.ok) {
    return result.data;
  }

  throw new Error(`${message} ${result.error.message}`);
}

function mapPullRequestStatus(state: string): string {
  if (state.toLowerCase() === "closed") {
    return "CLOSED";
  }

  return "OPEN";
}

function mapEnumValue(value: string): string {
  return value.toUpperCase().replace(/-/g, "_");
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function calculateValidatorRejectionRate(result: ReviewResult): number | undefined {
  const validationRejections = result.rejectedFindings.filter(isValidatorRejection).length;
  const total = result.findings.length + result.rejectedFindings.length;

  if (total === 0) {
    return undefined;
  }

  return validationRejections / total;
}

function isValidatorRejection(finding: RejectedFinding): boolean {
  return (
    finding.reason === "validator_low_confidence" ||
    finding.reason === "validator_rejected" ||
    finding.reason === "high_false_positive_risk"
  );
}

function readFirstStartedAt(result: ReviewResult): Date {
  const firstTiming = result.timings[0];

  return new Date(firstTiming?.startedAt ?? Date.now());
}

function readLastCompletedAt(result: ReviewResult): Date {
  const lastTiming = result.timings[result.timings.length - 1];

  return new Date(lastTiming?.completedAt ?? Date.now());
}
