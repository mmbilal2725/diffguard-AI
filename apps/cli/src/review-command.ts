import {
  createGitHubAppInstallationToken,
  createGitHubClient,
  type DiffGuardGitHubClient,
  type GitHubAppInstallationToken,
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
  validateFindingWithLlm,
  type LlmProvider,
  type ReviewPromptTemplateId,
} from "@diffguard/llm";
import { createJsonLogger, redactLogValue, type Logger } from "@diffguard/shared";
import { z } from "zod";

const DEFAULT_MIN_CONFIDENCE = 0.7;
const DEFAULT_OUTPUT_FORMAT = "markdown";
const AUTH_REQUIRED_MESSAGE =
  "GitHub authentication is required. Pass --github-token, set GITHUB_TOKEN, or provide GitHub App auth with --github-app-id, --github-app-installation-id, and --github-app-private-key.";
const SUPPORTED_REVIEW_OPTIONS = new Set([
  "dry-run",
  "github-app-id",
  "github-app-installation-id",
  "github-app-private-key",
  "github-token",
  "max-findings",
  "min-confidence",
  "model",
  "output",
  "owner",
  "pull-number",
  "repo",
  "review-passes",
]);

export { buildMarkdownSummary };

const ReviewCommandOptionsSchema = z.object({
  dryRun: z.boolean().default(false),
  githubAppId: z.string().min(1).optional(),
  githubAppInstallationId: z.string().min(1).optional(),
  githubAppPrivateKey: z.string().min(1).optional(),
  githubToken: z.string().min(1).optional(),
  maxFindings: z.number().int().positive().optional(),
  minConfidence: z.number().min(0).max(1).default(DEFAULT_MIN_CONFIDENCE),
  model: z.string().min(1).optional(),
  output: z.enum(["json", "markdown"]).default(DEFAULT_OUTPUT_FORMAT),
  owner: z.string().min(1),
  pullNumber: z.number().int().positive(),
  repo: z.string().min(1),
  reviewPasses: z.string().min(1).optional(),
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
  createInstallationToken?: (input: {
    appId: string;
    installationId: string;
    privateKey: string;
  }) => Promise<GitHubAppInstallationToken>;
  createLlmProvider?: (config: { apiKey: string; model?: string }) => LlmProvider;
  env?: Record<string, string | undefined>;
  findingValidator?: FindingValidator;
  logger?: Logger;
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

  validateRequiredReviewOptions(parsed);

  return parseReviewCommandSchema({
    dryRun: parsed["dry-run"] ?? false,
    githubAppId: parsed["github-app-id"],
    githubAppInstallationId: parsed["github-app-installation-id"],
    githubAppPrivateKey: parsed["github-app-private-key"],
    githubToken: parsed["github-token"],
    maxFindings: parsed["max-findings"],
    minConfidence: parsed["min-confidence"],
    model: parsed.model,
    output: parsed.output,
    owner: parsed.owner,
    pullNumber: parsed["pull-number"],
    repo: parsed.repo,
    reviewPasses: parsed["review-passes"],
  });
}

function normalizeCliArgv(argv: string[]): string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

export async function runReviewCommand(
  options: ReviewCommandOptions,
  dependencies: ReviewCommandDependencies = {},
): Promise<ReviewCommandResult> {
  const logger =
    dependencies.logger ??
    createJsonLogger({
      service: "diffguard-cli",
      sink: (line) => process.stderr.write(`${line}\n`),
    });
  const startedAt = Date.now();
  logger.info(
    {
      pullNumber: options.pullNumber,
      repository: `${options.owner}/${options.repo}`,
      status: "started",
    },
    "cli.review.started",
  );
  const env = dependencies.env ?? process.env;
  const authToken = await resolveGitHubAuthToken(options, dependencies, env);

  const githubClientFactory = dependencies.createGitHubClient ?? createGitHubClient;
  const githubClient = githubClientFactory({ authToken });
  const pipeline = dependencies.runReviewPipeline ?? runReviewPipeline;
  const llmReviewerSetup = buildDefaultLlmReviewerInput({
    createLlmProvider: dependencies.createLlmProvider,
    env,
    model: options.model,
    reviewPasses: options.reviewPasses,
  });
  const findingValidator = dependencies.findingValidator ?? llmReviewerSetup.findingValidator;
  const pipelineInput: RunReviewPipelineInput = {
    confidenceThreshold: options.minConfidence,
    dryRun: options.dryRun,
    github: { client: githubClient },
    ...(dependencies.runReviewPipeline === undefined ? { logger } : {}),
    owner: options.owner,
    pullNumber: options.pullNumber,
    repo: options.repo,
    ...(areStaticChecksEnabled(env) ? {} : { staticChecksEnabled: false }),
    ...(findingValidator === undefined
      ? {}
      : { findingValidator }),
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

  const commandResult = {
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

  logger.info(
    {
      ...summarizeReviewResult(finalized.result),
      durationMs: Date.now() - startedAt,
      posted: finalized.posted,
      pullNumber: options.pullNumber,
      repository: `${options.owner}/${options.repo}`,
      status: "completed",
    },
    "cli.review.completed",
  );

  return commandResult;
}

function areStaticChecksEnabled(env: Record<string, string | undefined>): boolean {
  const value = env.DIFFGUARD_STATIC_CHECKS?.trim().toLowerCase();

  return value !== "false" && value !== "0" && value !== "off" && value !== "disabled";
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
    if (!SUPPORTED_REVIEW_OPTIONS.has(key)) {
      throw new Error(`Unknown option --${key}.`);
    }

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

function validateRequiredReviewOptions(parsed: Record<string, ParsedArgValue>): void {
  if (typeof parsed.owner !== "string" || parsed.owner.trim() === "") {
    throw new Error("Missing required option --owner.");
  }
  if (typeof parsed.repo !== "string" || parsed.repo.trim() === "") {
    throw new Error("Missing required option --repo.");
  }
  if (parsed["pull-number"] === undefined) {
    throw new Error("Missing required option --pull-number.");
  }
}

function parseReviewCommandSchema(input: Record<string, ParsedArgValue>): ReviewCommandOptions {
  const result = ReviewCommandOptionsSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  throw new Error(formatReviewOptionError(result.error));
}

function formatReviewOptionError(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path[0];

  if (path === "pullNumber") {
    return "--pull-number must be a positive integer.";
  }
  if (path === "minConfidence") {
    return "--min-confidence must be between 0 and 1.";
  }
  if (path === "maxFindings") {
    return "--max-findings must be a positive integer.";
  }
  if (path === "output") {
    return "--output must be markdown or json.";
  }
  if (path === "reviewPasses") {
    return "--review-passes must be a comma-separated list of review pass ids.";
  }

  return issue?.message ?? "Invalid review command options.";
}

async function resolveGitHubAuthToken(
  options: ReviewCommandOptions,
  dependencies: ReviewCommandDependencies,
  env: Record<string, string | undefined>,
): Promise<string> {
  const directToken = firstNonEmpty(options.githubToken, env.GITHUB_TOKEN);
  if (directToken !== undefined) {
    return directToken;
  }

  const appId = firstNonEmpty(options.githubAppId, env.GITHUB_APP_ID);
  const installationId = firstNonEmpty(
    options.githubAppInstallationId,
    env.GITHUB_APP_INSTALLATION_ID,
  );
  const privateKey = normalizePrivateKey(
    firstNonEmpty(options.githubAppPrivateKey, env.GITHUB_APP_PRIVATE_KEY),
  );
  const hasPartialAppAuth =
    appId !== undefined || installationId !== undefined || privateKey !== undefined;

  if (!hasPartialAppAuth) {
    throw new Error(AUTH_REQUIRED_MESSAGE);
  }

  if (appId === undefined || installationId === undefined || privateKey === undefined) {
    throw new Error(AUTH_REQUIRED_MESSAGE);
  }

  const createInstallationToken =
    dependencies.createInstallationToken ?? createGitHubAppInstallationToken;
  const installationToken = await createInstallationToken({
    appId,
    installationId,
    privateKey,
  });

  return installationToken.token;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed !== "") {
      return trimmed;
    }
  }

  return undefined;
}

function normalizePrivateKey(value: string | undefined): string | undefined {
  return value?.replace(/\\n/g, "\n");
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
  reviewPasses?: string;
}): { findingValidator?: FindingValidator; llmReviewer?: LlmReviewer; warnings: string[] } {
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
  const passes = parseReviewPasses(input.reviewPasses ?? input.env.DIFFGUARD_REVIEW_PASSES);
  const validatorModel = resolveValidatorModel(input.env);

  return {
    ...(validatorModel === undefined
      ? {}
      : {
          findingValidator: createFindingLlmValidator({
            model: validatorModel,
            provider,
          }),
        }),
    llmReviewer: createReviewDiffLlmReviewer({
      model: input.model,
      passes,
      provider,
    }),
    warnings: [],
  };
}

function resolveValidatorModel(env: Record<string, string | undefined>): string | undefined {
  const validatorModel = env.DIFFGUARD_VALIDATOR_MODEL?.trim();
  if (validatorModel !== undefined && validatorModel !== "") {
    return validatorModel;
  }

  const resolutionModel = env.OPENAI_RESOLUTION_MODEL?.trim();
  return resolutionModel === undefined || resolutionModel === "" ? undefined : resolutionModel;
}

function createFindingLlmValidator(input: {
  model: string;
  provider: LlmProvider;
}): FindingValidator {
  return async (validatorInput) => {
    const result = await validateFindingWithLlm({
      changedFilePatch: validatorInput.changedFilePatch,
      diff: validatorInput.diff,
      finding: validatorInput.finding,
      model: input.model,
      provider: input.provider,
      providerName: "openai",
      reviewerConfidence: validatorInput.reviewerConfidence,
      rules: validatorInput.rules,
      staticAnalysisContext: validatorInput.staticCheckResults,
    });

    return {
      confidence: result.confidence,
      falsePositiveRisk: result.falsePositiveRisk,
      ...(result.improvedComment === undefined ? {} : { improvedComment: result.improvedComment }),
      reason: result.reason,
      shouldPost: result.shouldPost,
      valid: result.valid,
    };
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

export function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown DiffGuard-AI CLI error.";

  return String(redactLogValue(message));
}

function summarizeReviewResult(result: ReviewResult): {
  estimatedCostUsd: number;
  findings: number;
  modelName?: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  validatorRejectionRate: number;
} {
  const modelSummary = result.modelCalls.reduce(
    (summary, call) => ({
      estimatedCostUsd: summary.estimatedCostUsd + call.costUsd,
      modelName: summary.modelName ?? call.model,
      tokenUsage: {
        inputTokens: summary.tokenUsage.inputTokens + call.tokenUsage.inputTokens,
        outputTokens: summary.tokenUsage.outputTokens + call.tokenUsage.outputTokens,
        totalTokens: summary.tokenUsage.totalTokens + call.tokenUsage.totalTokens,
      },
    }),
    {
      estimatedCostUsd: 0,
      modelName: undefined as string | undefined,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    },
  );
  const validatorRejections = result.rejectedFindings.filter(
    (finding) => finding.reason === "validator_low_confidence" || finding.reason === "validator_rejected",
  ).length;
  const candidateCount = result.findings.length + result.rejectedFindings.length;

  return {
    estimatedCostUsd: modelSummary.estimatedCostUsd,
    findings: result.findings.length,
    ...(modelSummary.modelName === undefined ? {} : { modelName: modelSummary.modelName }),
    tokenUsage: modelSummary.tokenUsage,
    validatorRejectionRate: candidateCount === 0 ? 0 : validatorRejections / candidateCount,
  };
}
