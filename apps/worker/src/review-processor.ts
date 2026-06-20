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
  trackFindingResolutions,
  type FindingResolutionResult,
  type ResolutionMetrics,
  type ResolutionValidator,
  type ReviewResult,
  type RunReviewPipelineInput,
  type StoredPostedFinding,
} from "@diffguard/reviewer";
import { ReviewJobDataSchema, type ReviewJobData } from "@diffguard/shared";

type InstallationTokenFactory = (input: {
  appId: string;
  installationId: string;
  privateKey: string;
}) => Promise<GitHubAppInstallationToken>;

type ReviewPipelineRunner = (input: RunReviewPipelineInput) => Promise<ReviewResult>;
type GitHubClientFactory = (config: { authToken: string }) => DiffGuardGitHubClient;
type ReviewRunFinalizer = (input: FinalizeReviewRunInput) => Promise<FinalizeReviewRunResult>;

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
  log?: (message: string) => unknown;
};

export type CreateReviewProcessorOptions = {
  appId: string | undefined;
  createGitHubClient?: GitHubClientFactory;
  createInstallationToken?: InstallationTokenFactory;
  finalizeReviewRun?: ReviewRunFinalizer;
  loadPostedFindingDedupeKeys?: (input: PullRequestRef) => Promise<Set<string>>;
  privateKey: string | undefined;
  resolutionStore?: ResolutionStore;
  resolutionValidator?: ResolutionValidator;
  runReviewPipeline?: ReviewPipelineRunner;
  storeReviewRun?: (input: StoreReviewRunInput) => Promise<void>;
};

export function createReviewProcessor(options: CreateReviewProcessorOptions) {
  return async (job: ReviewJobLike): Promise<{ findings: number; reviewRunId: string }> => {
    const data = ReviewJobDataSchema.parse(job.data);

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
      dryRun: false,
      github: { client: githubClient },
      owner: data.owner,
      pullNumber: data.pullNumber,
      repo: data.repo,
    });
    const finalizer = options.finalizeReviewRun ?? finalizeReviewRun;
    const finalized = await finalizer({
      dryRun: false,
      githubClient,
      ...(options.loadPostedFindingDedupeKeys === undefined
        ? {}
        : { loadPostedFindingDedupeKeys: options.loadPostedFindingDedupeKeys }),
      ref: {
        number: data.pullNumber,
        owner: data.owner,
        repo: data.repo,
      },
      result,
      ...(options.storeReviewRun === undefined ? {} : { storeReviewRun: options.storeReviewRun }),
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

    return {
      findings: finalized.result.findings.length,
      reviewRunId: data.reviewRunId,
    };
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
