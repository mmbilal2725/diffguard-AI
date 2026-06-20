import {
  createGitHubClient,
  type DiffGuardGitHubClient,
  type GitHubResult,
  type PullRequestFile,
  type PullRequestRef,
  type ReviewCommentInput,
} from "@diffguard/github";
import {
  runReviewPipeline,
  type RejectedFinding,
  type ReviewResult,
  type RunReviewPipelineInput,
} from "@diffguard/reviewer";
import type { ReviewFinding } from "@diffguard/shared";
import { z } from "zod";

const DEFAULT_MIN_CONFIDENCE = 0.7;
const DEFAULT_OUTPUT_FORMAT = "markdown";

const ReviewCommandOptionsSchema = z.object({
  dryRun: z.boolean().default(false),
  githubToken: z.string().min(1).optional(),
  maxFindings: z.number().int().positive().optional(),
  minConfidence: z.number().min(0).max(1).default(DEFAULT_MIN_CONFIDENCE),
  model: z.string().min(1).optional(),
  output: z.enum(["json", "markdown"]).default(DEFAULT_OUTPUT_FORMAT),
  owner: z.string().min(1),
  pullNumber: z.number().int().positive(),
  repo: z.string().min(1),
});

export type ReviewCommandOptions = z.infer<typeof ReviewCommandOptionsSchema>;

export type ReviewCommandResult = {
  output: string;
  posted: boolean;
  reviewResult: ReviewResult;
  summary: string;
};

export type StoreReviewRunInput = {
  model?: string;
  posted: boolean;
  postedFindings?: PostedReviewFinding[];
  result: ReviewResult;
};

export type ReviewCommandDependencies = {
  createGitHubClient?: (config: { authToken: string }) => DiffGuardGitHubClient;
  env?: Record<string, string | undefined>;
  loadPostedFindingDedupeKeys?: (input: PullRequestRef) => Promise<Set<string>>;
  runReviewPipeline?: (input: RunReviewPipelineInput) => Promise<ReviewResult>;
  storeReviewRun?: (input: StoreReviewRunInput) => Promise<void>;
};

export type PostedReviewFinding = {
  dedupeKey: string;
  githubCommentId: string;
  line: number;
  path: string;
};

type ParsedArgValue = boolean | number | string | undefined;

type PrismaRepository = {
  id: string;
};

type PrismaPullRequest = {
  id: string;
};

type PrismaReviewRun = {
  id: string;
};

type PrismaClientLike = {
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

export function parseReviewCommandOptions(argv: string[]): ReviewCommandOptions {
  const normalizedArgv = normalizeCliArgv(argv);
  const [command, ...args] = normalizedArgv;
  if (command !== "review") {
    throw new Error("Expected command: diffguard-ai review");
  }

  const parsed = parseArgs(args);

  return ReviewCommandOptionsSchema.parse({
    dryRun: parsed["dry-run"] ?? false,
    githubToken: parsed["github-token"],
    maxFindings: parsed["max-findings"],
    minConfidence: parsed["min-confidence"],
    model: parsed.model,
    output: parsed.output,
    owner: parsed.owner,
    pullNumber: parsed["pull-number"],
    repo: parsed.repo,
  });
}

function normalizeCliArgv(argv: string[]): string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

export async function runReviewCommand(
  options: ReviewCommandOptions,
  dependencies: ReviewCommandDependencies = {},
): Promise<ReviewCommandResult> {
  const env = dependencies.env ?? process.env;
  const authToken = options.githubToken ?? env.GITHUB_TOKEN;

  if (authToken === undefined || authToken.trim() === "") {
    throw new Error("GitHub token is required. Pass --github-token or set GITHUB_TOKEN.");
  }

  const githubClientFactory = dependencies.createGitHubClient ?? createGitHubClient;
  const githubClient = githubClientFactory({ authToken });
  const pipeline = dependencies.runReviewPipeline ?? runReviewPipeline;
  const rawReviewResult = await pipeline({
    confidenceThreshold: options.minConfidence,
    dryRun: options.dryRun,
    github: { client: githubClient },
    owner: options.owner,
    pullNumber: options.pullNumber,
    repo: options.repo,
  });
  const ref = {
    number: options.pullNumber,
    owner: options.owner,
    repo: options.repo,
  };
  const postedDedupeKeys =
    options.dryRun || env.DATABASE_URL === undefined || env.DATABASE_URL.trim() === ""
      ? new Set<string>()
      : await (dependencies.loadPostedFindingDedupeKeys ?? loadPostedFindingDedupeKeysFromDatabase)(
          ref,
        );
  const reviewResult = limitFindings(
    filterPreviouslyPostedFindings(rawReviewResult, postedDedupeKeys),
    options.maxFindings,
  );
  const summary = buildMarkdownSummary(reviewResult, {
    dryRun: options.dryRun,
    maxFindings: options.maxFindings,
    minConfidence: options.minConfidence,
    model: options.model,
  });
  let posted = false;
  let postedFindings: PostedReviewFinding[] = [];

  if (!options.dryRun) {
    const postingResult = await postReviewFindings({
      githubClient,
      ref,
      result: reviewResult,
      summary,
      summaryOptions: {
        dryRun: options.dryRun,
        maxFindings: options.maxFindings,
        minConfidence: options.minConfidence,
        model: options.model,
      },
    });

    posted = postingResult.posted;
    postedFindings = postingResult.postedFindings;
  }

  if (env.DATABASE_URL !== undefined && env.DATABASE_URL.trim() !== "") {
    const storeReviewRun = dependencies.storeReviewRun ?? storeReviewRunInDatabase;
    await storeReviewRun({ model: options.model, posted, postedFindings, result: reviewResult });
  }

  return {
    output:
      options.output === "json"
        ? buildJsonOutput(reviewResult, { dryRun: options.dryRun, model: options.model, posted })
        : summary,
    posted,
    reviewResult,
    summary,
  };
}

export function buildMarkdownSummary(
  result: ReviewResult,
  options: {
    dryRun: boolean;
    maxFindings?: number;
    minConfidence: number;
    model?: string;
  },
): string {
  const findings =
    options.maxFindings === undefined ? result.findings : result.findings.slice(0, options.maxFindings);
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

function parseArgs(args: string[]): Record<string, ParsedArgValue> {
  const parsed: Record<string, ParsedArgValue> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined || !arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg ?? ""}`);
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (rawKey === undefined || rawKey === "") {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = rawKey;

    if (key === "dry-run") {
      parsed[key] = inlineValue === undefined ? true : inlineValue === "true";
      continue;
    }

    const value = inlineValue ?? args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    parsed[key] = parseArgValue(key, value);

    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return parsed;
}

function parseArgValue(key: string, value: string): ParsedArgValue {
  if (key === "pull-number" || key === "max-findings") {
    return Number.parseInt(value, 10);
  }

  if (key === "min-confidence") {
    return Number.parseFloat(value);
  }

  return value;
}

function limitFindings(result: ReviewResult, maxFindings: number | undefined): ReviewResult {
  if (maxFindings === undefined || result.findings.length <= maxFindings) {
    return result;
  }

  return {
    ...result,
    findings: result.findings.slice(0, maxFindings),
  };
}

function filterPreviouslyPostedFindings(
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

async function postReviewFindings(input: {
  githubClient: DiffGuardGitHubClient;
  ref: PullRequestRef;
  result: ReviewResult;
  summary: string;
  summaryOptions: {
    dryRun: boolean;
    maxFindings?: number;
    minConfidence: number;
    model?: string;
  };
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
      { ...input.result, findings: planned.fallback.map((plannedFinding) => plannedFinding.finding) },
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

function planReviewPosting(result: ReviewResult): {
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

  const diffLines = parsePatchLines(file.patch);
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

function parsePatchLines(
  patch: string,
): Array<{ kind: "add" | "context" | "delete"; newLine?: number; oldLine?: number }> {
  const diffLines: Array<{ kind: "add" | "context" | "delete"; newLine?: number; oldLine?: number }> =
    [];
  let oldLine: number | undefined;
  let newLine: number | undefined;

  for (const patchLine of patch.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(patchLine);
    if (hunk !== null) {
      oldLine = Number.parseInt(hunk[1] ?? "0", 10);
      newLine = Number.parseInt(hunk[2] ?? "0", 10);
      continue;
    }

    if (oldLine === undefined || newLine === undefined || patchLine.startsWith("\\")) {
      continue;
    }

    if (patchLine.startsWith("+")) {
      diffLines.push({ kind: "add", newLine });
      newLine += 1;
      continue;
    }

    if (patchLine.startsWith("-")) {
      diffLines.push({ kind: "delete", oldLine });
      oldLine += 1;
      continue;
    }

    diffLines.push({ kind: "context", newLine, oldLine });
    oldLine += 1;
    newLine += 1;
  }

  return diffLines;
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

function buildJsonOutput(
  result: ReviewResult,
  options: {
    dryRun: boolean;
    model?: string;
    posted: boolean;
  },
): string {
  return JSON.stringify(
    {
      dryRun: options.dryRun,
      findings: result.findings,
      model: options.model ?? null,
      posted: options.posted,
      pullRequest: result.pullRequest,
      rejectedFindings: result.rejectedFindings,
      rules: result.context.rules,
      timings: result.timings,
    },
    null,
    2,
  );
}

async function storeReviewRunInDatabase(input: StoreReviewRunInput): Promise<void> {
  const { createDatabaseClient } = await import("@diffguard/database");
  const database = createDatabaseClient() as unknown as PrismaClientLike;

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

async function loadPostedFindingDedupeKeysFromDatabase(input: PullRequestRef): Promise<Set<string>> {
  const { createDatabaseClient } = await import("@diffguard/database");
  const database = createDatabaseClient() as unknown as PrismaClientLike;

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
            number: input.number,
            repository: {
              name: input.repo,
              owner: input.owner,
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

function buildFindingDedupeKey(finding: ReviewFinding): string {
  return [finding.filePath, finding.line, finding.category, normalizeTitle(finding.title)].join(
    ":",
  );
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
