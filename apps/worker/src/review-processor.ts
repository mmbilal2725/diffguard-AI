import {
  createGitHubAppInstallationToken,
  createGitHubClient,
  type DiffGuardGitHubClient,
  type GitHubAppInstallationToken,
  type PullRequestRef,
} from "@diffguard/github";
import {
  finalizeReviewRun,
  type FinalizeReviewRunInput,
  type FinalizeReviewRunResult,
  type StoreReviewRunInput,
} from "@diffguard/review-run";
import {
  runReviewPipeline,
  type FindingValidator,
  trackFindingResolutions,
  type FindingResolutionResult,
  type LlmReviewer,
  type ResolutionMetrics,
  type ResolutionValidator,
  type ReviewResult,
  type RunReviewPipelineInput,
  type StaticCheckRunner,
  type StoredPostedFinding,
} from "@diffguard/reviewer";
import {
  ReviewJobDataSchema,
  toErrorLogFields,
  type Logger,
  type ReviewJobData,
} from "@diffguard/shared";

type InstallationTokenFactory = (input: {
  appId: string;
  installationId: string;
  privateKey: string;
}) => Promise<GitHubAppInstallationToken>;

type ReviewPipelineRunner = (input: RunReviewPipelineInput) => Promise<ReviewResult>;
type GitHubClientFactory = (config: { authToken: string }) => DiffGuardGitHubClient;
type ReviewRunFinalizer = (input: FinalizeReviewRunInput) => Promise<FinalizeReviewRunResult>;
type ReviewRunFailureMarker = (input: {
  error: unknown;
  reviewRunId: string;
}) => Promise<void>;
type ReviewCompletionSummary = ReturnType<typeof summarizeReviewResult> & { durationMs: number };

export type ResolutionStore = {
  listPostedFindings(input: {
    owner: string;
    pullNumber: number;
    repo: string;
  }): Promise<StoredPostedFinding[]>;
  saveResolutionResults(input: {
    metrics: ResolutionMetrics;
    results: FindingResolutionResult[];
    reviewRunId: string;
  }): Promise<void>;
};

export type ReviewJobLike = {
  data: ReviewJobData;
  id?: string;
  log?: (message: string) => unknown;
};

export type CreateReviewProcessorOptions = {
  appId: string | undefined;
  confidenceThreshold?: number;
  createGitHubClient?: GitHubClientFactory;
  createInstallationToken?: InstallationTokenFactory;
  findingValidator?: FindingValidator;
  finalizeReviewRun?: ReviewRunFinalizer;
  loadPostedFindingDedupeKeys?: (input: PullRequestRef) => Promise<Set<string>>;
  logger?: Logger;
  llmReviewer?: LlmReviewer;
  markReviewRunFailed?: ReviewRunFailureMarker;
  maxFindings?: number;
  minConfidence?: number;
  model?: string;
  onReviewCompleted?: (summary: ReviewCompletionSummary) => void;
  privateKey: string | undefined;
  resolutionStore?: ResolutionStore;
  resolutionValidator?: ResolutionValidator;
  runReviewPipeline?: ReviewPipelineRunner;
  staticCheckRunner?: StaticCheckRunner;
  staticChecksEnabled?: boolean;
  storeReviewRun?: (input: StoreReviewRunInput) => Promise<void>;
};

export function createReviewProcessor(options: CreateReviewProcessorOptions) {
  return async (job: ReviewJobLike): Promise<{ findings: number; reviewRunId: string }> => {
    const data = ReviewJobDataSchema.parse(job.data);
    const startedAt = Date.now();
    const baseLogFields = {
      jobId: job.id,
      pullNumber: data.pullNumber,
      repository: `${data.owner}/${data.repo}`,
      reviewRunId: data.reviewRunId,
      webhookDeliveryId: data.deliveryId,
    };

    options.logger?.info(
      {
        ...baseLogFields,
        status: "started",
      },
      "worker.review_job.started",
    );

    try {
      if (options.appId === undefined || options.privateKey === undefined) {
        throw new Error("GitHub App credentials are required to process review jobs.");
      }

      await job.log?.(`Starting review run ${data.reviewRunId}`);

      const tokenFactory = options.createInstallationToken ?? createGitHubAppInstallationToken;
      const installationToken = await tokenFactory({
        appId: options.appId,
        installationId: data.installationId,
        privateKey: options.privateKey,
      });
      const githubClientFactory = options.createGitHubClient ?? createGitHubClient;
      const githubClient = githubClientFactory({ authToken: installationToken.token });
      const pipeline = options.runReviewPipeline ?? runReviewPipeline;
      const result = await pipeline({
        ...(options.confidenceThreshold === undefined
          ? {}
          : { confidenceThreshold: options.confidenceThreshold }),
        dryRun: false,
        ...(options.findingValidator === undefined
          ? {}
          : { findingValidator: options.findingValidator }),
        github: { client: githubClient },
        ...(options.llmReviewer === undefined ? {} : { llmReviewer: options.llmReviewer }),
        owner: data.owner,
        pullNumber: data.pullNumber,
        repo: data.repo,
        reviewRunId: data.reviewRunId,
        ...(options.logger === undefined ? {} : { logger: options.logger }),
        ...(options.staticCheckRunner === undefined
          ? {}
          : { staticCheckRunner: options.staticCheckRunner }),
        ...(options.staticChecksEnabled === undefined
          ? {}
          : { staticChecksEnabled: options.staticChecksEnabled }),
      });
      const finalizer = options.finalizeReviewRun ?? finalizeReviewRun;
      const storeReviewRun = options.storeReviewRun;
      const finalized = await finalizer({
        dryRun: false,
        githubClient,
        ...(options.loadPostedFindingDedupeKeys === undefined
          ? {}
          : { loadPostedFindingDedupeKeys: options.loadPostedFindingDedupeKeys }),
        ...(options.maxFindings === undefined ? {} : { maxFindings: options.maxFindings }),
        ...(options.minConfidence === undefined ? {} : { minConfidence: options.minConfidence }),
        ...(options.model === undefined ? {} : { model: options.model }),
        ref: {
          number: data.pullNumber,
          owner: data.owner,
          repo: data.repo,
        },
        result,
        ...(storeReviewRun === undefined
          ? {}
          : {
              storeReviewRun: (input) =>
                storeReviewRun({
                  ...input,
                  reviewRunId: data.reviewRunId,
                }),
            }),
      });

      if (options.resolutionStore !== undefined && options.resolutionValidator !== undefined) {
        const postedFindings = await options.resolutionStore.listPostedFindings({
          owner: data.owner,
          pullNumber: data.pullNumber,
          repo: data.repo,
        });

        if (postedFindings.length > 0) {
          const resolutionResult = await trackFindingResolutions({
            findings: postedFindings,
            latestDiff: buildLatestDiff(finalized.result),
            latestFiles: finalized.result.context.files,
            validator: options.resolutionValidator,
          });

          await options.resolutionStore.saveResolutionResults({
            ...resolutionResult,
            reviewRunId: data.reviewRunId,
          });
        }
      }

      await job.log?.(`Completed review run ${data.reviewRunId}`);
      const reviewSummary = {
        ...summarizeReviewResult(finalized.result),
        durationMs: Date.now() - startedAt,
      };
      options.onReviewCompleted?.(reviewSummary);
      options.logger?.info(
        {
          ...baseLogFields,
          ...reviewSummary,
          status: "completed",
        },
        "worker.review_job.completed",
      );

      return {
        findings: finalized.result.findings.length,
        reviewRunId: data.reviewRunId,
      };
    } catch (error) {
      options.logger?.error(
        {
          ...baseLogFields,
          ...toErrorLogFields(error),
          durationMs: Date.now() - startedAt,
          status: "failed",
        },
        "worker.review_job.failed",
      );
      await options.markReviewRunFailed?.({
        error,
        reviewRunId: data.reviewRunId,
      });
      throw error;
    }
  };
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

function buildLatestDiff(result: ReviewResult): string {
  if (result.context.files.length === 0) {
    return "";
  }

  return result.context.files
    .map((file) =>
      [`File: ${file.filename}`, "Patch:", file.patch ?? "No patch available."].join("\n"),
    )
    .join("\n\n");
}
