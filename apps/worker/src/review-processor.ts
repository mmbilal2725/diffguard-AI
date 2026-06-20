import { createGitHubAppInstallationToken, type GitHubAppInstallationToken } from "@diffguard/github";
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
  createInstallationToken?: InstallationTokenFactory;
  privateKey: string | undefined;
  resolutionStore?: ResolutionStore;
  resolutionValidator?: ResolutionValidator;
  runReviewPipeline?: ReviewPipelineRunner;
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
    const pipeline = options.runReviewPipeline ?? runReviewPipeline;
    const result = await pipeline({
      dryRun: false,
      github: { authToken: installationToken.token },
      owner: data.owner,
      pullNumber: data.pullNumber,
      repo: data.repo,
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
          latestDiff: buildLatestDiff(result),
          latestFiles: result.context.files,
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
      findings: result.findings.length,
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
