import {
  createGitHubClient,
  type DiffGuardGitHubClient,
  type PullRequestFile,
  type PullRequestRef,
} from "@diffguard/github";
import {
  runReviewPipeline,
  type FindingValidator,
  type LlmReviewer,
  type ReviewResult,
  type RunReviewPipelineInput,
} from "@diffguard/reviewer";
import {
  buildMarkdownSummary,
  finalizeReviewRun,
  loadPostedFindingDedupeKeysFromDatabase,
  storeReviewRunInDatabase,
  type StoreReviewRunInput,
} from "@diffguard/review-run";
import {
  createOpenAIProvider,
  reviewDiffWithLlm,
  type LlmProvider,
  type ReviewPromptTemplateId,
} from "@diffguard/llm";
import { z } from "zod";

const DEFAULT_MIN_CONFIDENCE = 0.7;
const DEFAULT_OUTPUT_FORMAT = "markdown";
const REVIEW_TEMPLATE_IDS = [
  "logic-bugs",
  "security-bugs",
  "regression-test-gaps",
] as const satisfies readonly ReviewPromptTemplateId[];

export { buildMarkdownSummary };

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

export type ReviewCommandDependencies = {
  createGitHubClient?: (config: { authToken: string }) => DiffGuardGitHubClient;
  createLlmProvider?: (config: { apiKey: string; model?: string }) => LlmProvider;
  env?: Record<string, string | undefined>;
  findingValidator?: FindingValidator;
  loadPostedFindingDedupeKeys?: (input: PullRequestRef) => Promise<Set<string>>;
  runReviewPipeline?: (input: RunReviewPipelineInput) => Promise<ReviewResult>;
  storeReviewRun?: (input: StoreReviewRunInput) => Promise<void>;
};

type ParsedArgValue = boolean | number | string | undefined;

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
  const pipelineInput: RunReviewPipelineInput = {
    confidenceThreshold: options.minConfidence,
    dryRun: options.dryRun,
    github: { client: githubClient },
    owner: options.owner,
    pullNumber: options.pullNumber,
    repo: options.repo,
    ...(dependencies.findingValidator === undefined
      ? {}
      : { findingValidator: dependencies.findingValidator }),
    ...buildDefaultLlmReviewerInput({
      createLlmProvider: dependencies.createLlmProvider,
      env,
      model: options.model,
    }),
  };
  const rawReviewResult = await pipeline(pipelineInput);
  const ref = {
    number: options.pullNumber,
    owner: options.owner,
    repo: options.repo,
  };
  const persistenceEnabled = env.DATABASE_URL !== undefined && env.DATABASE_URL.trim() !== "";
  const finalized = await finalizeReviewRun({
    dryRun: options.dryRun,
    githubClient,
    ...(persistenceEnabled && !options.dryRun
      ? {
          loadPostedFindingDedupeKeys:
            dependencies.loadPostedFindingDedupeKeys ??
            ((input) => loadPostedFindingDedupeKeysFromDatabase({ ref: input })),
        }
      : {}),
    maxFindings: options.maxFindings,
    minConfidence: options.minConfidence,
    model: options.model,
    ref,
    result: rawReviewResult,
    ...(persistenceEnabled
      ? { storeReviewRun: dependencies.storeReviewRun ?? storeReviewRunInDatabase }
      : {}),
  });

  return {
    output:
      options.output === "json"
        ? buildJsonOutput(finalized.result, {
            dryRun: options.dryRun,
            model: options.model,
            posted: finalized.posted,
          })
        : finalized.summary,
    posted: finalized.posted,
    reviewResult: finalized.result,
    summary: finalized.summary,
  };
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

function buildDefaultLlmReviewerInput(input: {
  createLlmProvider?: (config: { apiKey: string; model?: string }) => LlmProvider;
  env: Record<string, string | undefined>;
  model?: string;
}): Pick<RunReviewPipelineInput, "llmReviewer"> {
  const apiKey = input.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    return {};
  }

  const provider = (input.createLlmProvider ?? createOpenAIProvider)({
    apiKey,
    model: input.model,
  });

  return {
    llmReviewer: createReviewDiffLlmReviewer({
      model: input.model,
      provider,
    }),
  };
}

function createReviewDiffLlmReviewer(input: {
  model?: string;
  provider: LlmProvider;
}): LlmReviewer {
  return async (context) => {
    const findings: ReviewResult["findings"] = [];
    const modelCalls: NonNullable<ReviewResult["modelCalls"]> = [];
    const diff = buildPullRequestDiff(context.files);
    const promptContext = buildPromptContext(context);

    for (const templateId of REVIEW_TEMPLATE_IDS) {
      const result = await reviewDiffWithLlm({
        context: promptContext,
        diff,
        ...(input.model === undefined ? {} : { model: input.model }),
        provider: input.provider,
        providerName: "openai",
        rules: context.rules.content,
        templateId,
      });

      findings.push(...result.findings);
      modelCalls.push(
        ...result.modelCalls.map((call) => ({
          ...call,
          templateId,
        })),
      );
    }

    return {
      findings,
      modelCalls,
    };
  };
}

function buildPromptContext(context: ReviewResult["context"]): string[] {
  return [
    `Pull request #${context.pullRequest.number}: ${context.pullRequest.title}`,
    `Base: ${context.pullRequest.baseRef} (${context.pullRequest.baseSha})`,
    `Head: ${context.pullRequest.headRef} (${context.pullRequest.headSha})`,
    `Changed files: ${context.files.map((file) => file.filename).join(", ") || "none"}`,
  ];
}

function buildPullRequestDiff(files: PullRequestFile[]): string {
  if (files.length === 0) {
    return "No changed files.";
  }

  return files.map(formatFileDiff).join("\n\n");
}

function formatFileDiff(file: PullRequestFile): string {
  return [`File: ${file.filename}`, "Patch:", file.patch ?? "No patch available."].join("\n");
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
      modelCalls: result.modelCalls,
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
