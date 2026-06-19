import {
  createGitHubClient,
  type DiffGuardGitHubClient,
  type GitHubError,
  type GitHubResult,
  type PullRequestFile,
  type PullRequestMetadata,
  type PullRequestRef,
} from "@diffguard/github";
import {
  FindingCategorySchema,
  FindingSeveritySchema,
  ReviewFindingSchema,
  type FindingCategory,
  type ReviewFinding,
} from "@diffguard/shared";
import { z } from "zod";

const MINIMUM_POSTABLE_CONFIDENCE = 0.7;
const DIFFGUARD_RULES_PATH = ".diffguard-rules.md";

const PipelineInputSchema = z.object({
  confidenceThreshold: z.number().min(0).max(1).default(MINIMUM_POSTABLE_CONFIDENCE),
  dryRun: z.boolean().default(false),
  owner: z.string().min(1),
  pullNumber: z.number().int().positive(),
  repo: z.string().min(1),
});

const StyleOnlyCategorySchema = z.enum(["style_only", "style", "formatting", "naming"]);
const ReviewerFindingCandidateSchema = z.object({
  category: z.union([FindingCategorySchema, StyleOnlyCategorySchema]),
  confidence: z.number().min(0).max(1),
  evidence: z.string().min(20).max(3000),
  filePath: z.string().min(1),
  line: z.number().int().positive(),
  relatedRuleIds: z.array(z.string().min(1)).default([]),
  severity: FindingSeveritySchema,
  side: z.enum(["LEFT", "RIGHT"]),
  suggestedFix: z.string().min(1).max(2000),
  summary: z.string().min(20).max(2000),
  title: z.string().min(8).max(160),
  whyItMatters: z.string().min(20).max(2000),
});

type ReviewerFindingCandidate = z.infer<typeof ReviewerFindingCandidateSchema>;
type StyleOnlyCategory = z.infer<typeof StyleOnlyCategorySchema>;

export type ReviewPipelineGitHubClient = Pick<
  DiffGuardGitHubClient,
  "getPullRequestMetadata" | "listPullRequestFiles" | "readDiffGuardRules"
>;

export type GitHubAuthContext =
  | {
      authToken: string;
      client?: never;
    }
  | {
      authToken?: string;
      client: ReviewPipelineGitHubClient;
    };

export type BuildReviewContextInput = {
  dryRun: boolean;
  files: PullRequestFile[];
  owner: string;
  pullNumber: number;
  pullRequest: PullRequestMetadata;
  repo: string;
  rules: string | null;
};

export type ReviewContext = {
  dryRun: boolean;
  files: PullRequestFile[];
  pullRequest: PullRequestMetadata;
  ref: PullRequestRef;
  rules: {
    content: string | null;
    found: boolean;
    path: typeof DIFFGUARD_RULES_PATH;
  };
};

export type PipelineStage =
  | "fetch_pull_request"
  | "list_changed_files"
  | "read_rules"
  | "build_context"
  | "static_checks"
  | "llm_review"
  | "validate_findings"
  | "dedupe_findings"
  | "filter_findings";

export type StageTiming = {
  completedAt: string;
  durationMs: number;
  stage: PipelineStage;
  startedAt: string;
};

export type RejectedFinding =
  | {
      reason: "duplicate" | "low_confidence" | "style_only";
      title: string;
    }
  | {
      reason: "invalid";
      title?: string;
      validationIssues: Array<{ message: string; path: string }>;
    };

export type ReviewResult = {
  context: ReviewContext;
  dryRun: boolean;
  findings: ReviewFinding[];
  pullRequest: PullRequestMetadata;
  rejectedFindings: RejectedFinding[];
  timings: StageTiming[];
};

export type LlmReviewer = (context: ReviewContext) => Promise<unknown[]>;
export type StaticCheckRunner = (context: ReviewContext) => Promise<unknown[]>;

export type RunReviewPipelineInput = {
  dryRun?: boolean;
  github: GitHubAuthContext;
  llmReviewer?: LlmReviewer;
  owner: string;
  pullNumber: number;
  repo: string;
  staticCheckRunner?: StaticCheckRunner;
  confidenceThreshold?: number;
};

export type PostableFindingCandidate = {
  confidence: number;
};

export class ReviewPipelineError extends Error {
  override readonly cause?: GitHubError;

  constructor(message: string, cause?: GitHubError) {
    super(message);
    this.name = "ReviewPipelineError";
    this.cause = cause;
  }
}

export function isPostableFinding(candidate: PostableFindingCandidate): boolean {
  return candidate.confidence >= MINIMUM_POSTABLE_CONFIDENCE;
}

export function buildReviewContext(input: BuildReviewContextInput): ReviewContext {
  return {
    dryRun: input.dryRun,
    files: [...input.files],
    pullRequest: input.pullRequest,
    ref: {
      number: input.pullNumber,
      owner: input.owner,
      repo: input.repo,
    },
    rules: {
      content: input.rules,
      found: input.rules !== null,
      path: DIFFGUARD_RULES_PATH,
    },
  };
}

export async function runReviewPipeline(input: RunReviewPipelineInput): Promise<ReviewResult> {
  const parsedInput = PipelineInputSchema.parse(input);
  const github = resolveGitHubClient(input.github);
  const timings: StageTiming[] = [];
  const ref: PullRequestRef = {
    number: parsedInput.pullNumber,
    owner: parsedInput.owner,
    repo: parsedInput.repo,
  };

  const pullRequest = await recordStage(timings, "fetch_pull_request", async () =>
    unwrapGitHubResult(await github.getPullRequestMetadata(ref), "Failed to fetch pull request."),
  );

  const files = await recordStage(timings, "list_changed_files", async () =>
    unwrapGitHubResult(
      await github.listPullRequestFiles(ref),
      "Failed to list pull request files.",
    ),
  );

  const rules = await recordStage(timings, "read_rules", async () => {
    const result = await github.readDiffGuardRules({
      owner: parsedInput.owner,
      ref: pullRequest.headSha,
      repo: parsedInput.repo,
    });

    if (!result.ok && result.error.kind === "not_found") {
      return null;
    }

    return unwrapGitHubResult(result, "Failed to read DiffGuard rules.");
  });

  const context = await recordStage(timings, "build_context", async () =>
    buildReviewContext({
      dryRun: parsedInput.dryRun,
      files,
      owner: parsedInput.owner,
      pullNumber: parsedInput.pullNumber,
      pullRequest,
      repo: parsedInput.repo,
      rules,
    }),
  );

  const staticCandidates = await recordStage(timings, "static_checks", async () =>
    (input.staticCheckRunner ?? runPlaceholderStaticChecks)(context),
  );

  const llmCandidates = await recordStage(timings, "llm_review", async () =>
    (input.llmReviewer ?? runPlaceholderLlmReviewer)(context),
  );

  const { findings: validatedFindings, rejectedFindings: validationRejects } = await recordStage(
    timings,
    "validate_findings",
    async () => validateReviewerFindings([...staticCandidates, ...llmCandidates]),
  );

  const { findings: dedupedFindings, rejectedFindings: duplicateRejects } = await recordStage(
    timings,
    "dedupe_findings",
    async () => dedupeFindings(validatedFindings),
  );

  const { findings, rejectedFindings: confidenceRejects } = await recordStage(
    timings,
    "filter_findings",
    async () => filterPostableFindings(dedupedFindings, parsedInput.confidenceThreshold),
  );

  return {
    context,
    dryRun: parsedInput.dryRun,
    findings,
    pullRequest,
    rejectedFindings: [...validationRejects, ...duplicateRejects, ...confidenceRejects],
    timings,
  };
}

export async function runPlaceholderStaticChecks(): Promise<unknown[]> {
  return [];
}

export async function runPlaceholderLlmReviewer(): Promise<unknown[]> {
  return [];
}

function resolveGitHubClient(context: GitHubAuthContext): ReviewPipelineGitHubClient {
  if ("client" in context && context.client !== undefined) {
    return context.client;
  }

  if ("authToken" in context && context.authToken !== undefined) {
    return createGitHubClient({ authToken: context.authToken });
  }

  throw new ReviewPipelineError("GitHub auth context must include a client or auth token.");
}

function validateReviewerFindings(candidates: unknown[]): {
  findings: ReviewerFindingCandidate[];
  rejectedFindings: RejectedFinding[];
} {
  const findings: ReviewerFindingCandidate[] = [];
  const rejectedFindings: RejectedFinding[] = [];

  for (const candidate of candidates) {
    const parsed = ReviewerFindingCandidateSchema.safeParse(candidate);
    const title = readCandidateTitle(candidate);

    if (!parsed.success) {
      rejectedFindings.push({
        reason: "invalid",
        title,
        validationIssues: parsed.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.join("."),
        })),
      });
      continue;
    }

    if (isStyleOnlyCategory(parsed.data.category)) {
      rejectedFindings.push({
        reason: "style_only",
        title: parsed.data.title,
      });
      continue;
    }

    findings.push(parsed.data);
  }

  return { findings, rejectedFindings };
}

function dedupeFindings(findings: ReviewerFindingCandidate[]): {
  findings: ReviewerFindingCandidate[];
  rejectedFindings: RejectedFinding[];
} {
  const seen = new Set<string>();
  const uniqueFindings: ReviewerFindingCandidate[] = [];
  const rejectedFindings: RejectedFinding[] = [];

  for (const finding of findings) {
    const key = [
      finding.filePath,
      finding.line,
      finding.category,
      normalizeTitle(finding.title),
    ].join(":");

    if (seen.has(key)) {
      rejectedFindings.push({
        reason: "duplicate",
        title: finding.title,
      });
      continue;
    }

    seen.add(key);
    uniqueFindings.push(finding);
  }

  return { findings: uniqueFindings, rejectedFindings };
}

function filterPostableFindings(
  candidates: ReviewerFindingCandidate[],
  threshold: number,
): {
  findings: ReviewFinding[];
  rejectedFindings: RejectedFinding[];
} {
  const findings: ReviewFinding[] = [];
  const rejectedFindings: RejectedFinding[] = [];

  for (const candidate of candidates) {
    if (candidate.confidence < threshold) {
      rejectedFindings.push({
        reason: "low_confidence",
        title: candidate.title,
      });
      continue;
    }

    const parsed = ReviewFindingSchema.safeParse(candidate);
    if (!parsed.success) {
      rejectedFindings.push({
        reason: "invalid",
        title: candidate.title,
        validationIssues: parsed.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.join("."),
        })),
      });
      continue;
    }

    findings.push(parsed.data);
  }

  return { findings, rejectedFindings };
}

async function recordStage<T>(
  timings: StageTiming[],
  stage: PipelineStage,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  try {
    return await operation();
  } finally {
    const completedAtMs = Date.now();
    timings.push({
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: completedAtMs - startedAtMs,
      stage,
      startedAt,
    });
  }
}

function unwrapGitHubResult<T>(result: GitHubResult<T>, message: string): T {
  if (result.ok) {
    return result.data;
  }

  throw new ReviewPipelineError(message, result.error);
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readCandidateTitle(candidate: unknown): string | undefined {
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "title" in candidate &&
    typeof (candidate as { title: unknown }).title === "string"
  ) {
    return (candidate as { title: string }).title;
  }

  return undefined;
}

function isStyleOnlyCategory(
  category: FindingCategory | StyleOnlyCategory,
): category is StyleOnlyCategory {
  return StyleOnlyCategorySchema.safeParse(category).success;
}
