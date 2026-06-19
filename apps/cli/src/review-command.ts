import { createGitHubClient, type DiffGuardGitHubClient, type GitHubResult } from "@diffguard/github";
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
  result: ReviewResult;
};

export type ReviewCommandDependencies = {
  createGitHubClient?: (config: { authToken: string }) => DiffGuardGitHubClient;
  env?: Record<string, string | undefined>;
  runReviewPipeline?: (input: RunReviewPipelineInput) => Promise<ReviewResult>;
  storeReviewRun?: (input: StoreReviewRunInput) => Promise<void>;
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
  const [command, ...args] = argv;
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
  const reviewResult = limitFindings(rawReviewResult, options.maxFindings);
  const summary = buildMarkdownSummary(reviewResult, {
    dryRun: options.dryRun,
    maxFindings: options.maxFindings,
    minConfidence: options.minConfidence,
    model: options.model,
  });
  let posted = false;

  if (!options.dryRun) {
    unwrapGitHubResult(
      await githubClient.postPullRequestComment({
        body: summary,
        ref: {
          number: options.pullNumber,
          owner: options.owner,
          repo: options.repo,
        },
      }),
      "Failed to post pull request summary comment.",
    );
    posted = true;
  }

  if (env.DATABASE_URL !== undefined && env.DATABASE_URL.trim() !== "") {
    const storeReviewRun = dependencies.storeReviewRun ?? storeReviewRunInDatabase;
    await storeReviewRun({ model: options.model, posted, result: reviewResult });
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
      await database.finding.createMany({
        data: input.result.findings.map((finding) => ({
          category: mapEnumValue(finding.category),
          confidence: finding.confidence,
          dedupeKey: buildFindingDedupeKey(finding),
          evidence: finding.evidence,
          filePath: finding.filePath,
          line: finding.line,
          relatedRuleIds: finding.relatedRuleIds,
          reviewRunId: reviewRun.id,
          severity: mapEnumValue(finding.severity),
          side: finding.side,
          status: input.posted ? "POSTED" : "VALIDATED",
          suggestedFix: finding.suggestedFix,
          summary: finding.summary,
          title: finding.title,
          whyItMatters: finding.whyItMatters,
        })),
        skipDuplicates: true,
      });
    }
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
