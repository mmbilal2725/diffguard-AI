import {
  createGitHubClient,
  type DiffGuardGitHubClient,
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
  OPENAI_API_KEY_MISSING_WARNING,
  createOpenAIProvider,
  parseReviewPasses,
  reviewDiffWithLlm,
  type LlmProvider,
  type ReviewPromptTemplateId,
} from "@diffguard/llm";
import { z } from "zod";

const DEFAULT_MIN_CONFIDENCE = 0.7;
const DEFAULT_OUTPUT_FORMAT = "markdown";

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
  warnings: string[];
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
  const llmReviewerSetup = buildDefaultLlmReviewerInput({
    createLlmProvider: dependencies.createLlmProvider,
    env,
    model: options.model,
  });
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
    ...(llmReviewerSetup.llmReviewer === undefined
      ? {}
      : { llmReviewer: llmReviewerSetup.llmReviewer }),
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
            warnings: llmReviewerSetup.warnings,
          })
        : appendWarningsToMarkdown(finalized.summary, llmReviewerSetup.warnings),
    posted: finalized.posted,
    reviewResult: finalized.result,
    summary: finalized.summary,
    warnings: llmReviewerSetup.warnings,
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
}): { llmReviewer?: LlmReviewer; warnings: string[] } {
  const apiKey = input.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    return {
      warnings: [OPENAI_API_KEY_MISSING_WARNING],
    };
  }

  const provider = (input.createLlmProvider ?? createOpenAIProvider)({
    apiKey,
    model: input.model,
  });
  const passes = parseReviewPasses(input.env.DIFFGUARD_REVIEW_PASSES);

  return {
    llmReviewer: createReviewDiffLlmReviewer({
      model: input.model,
      passes,
      provider,
    }),
    warnings: [],
  };
}

function createReviewDiffLlmReviewer(input: {
  model?: string;
  passes: ReviewPromptTemplateId[];
  provider: LlmProvider;
}): LlmReviewer {
  return async (context) => {
    const findings: ReviewResult["findings"] = [];
    const modelCalls: NonNullable<ReviewResult["modelCalls"]> = [];
    const diff = context.diff;
    const promptContext = buildPromptContext(context);

    for (const templateId of input.passes) {
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

function buildJsonOutput(
  result: ReviewResult,
  options: {
    dryRun: boolean;
    model?: string;
    posted: boolean;
    warnings: string[];
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
      warnings: options.warnings,
    },
    null,
    2,
  );
}

function appendWarningsToMarkdown(summary: string, warnings: string[]): string {
  if (warnings.length === 0) {
    return summary;
  }

  return `${summary}\n\n## Warnings\n${warnings.map((warning) => `- ${warning}`).join("\n")}`;
}
