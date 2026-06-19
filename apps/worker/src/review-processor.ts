import { createGitHubAppInstallationToken, type GitHubAppInstallationToken } from "@diffguard/github";
import { runReviewPipeline, type ReviewResult, type RunReviewPipelineInput } from "@diffguard/reviewer";
import { ReviewJobDataSchema, type ReviewJobData } from "@diffguard/shared";

type InstallationTokenFactory = (input: {
  appId: string;
  installationId: string;
  privateKey: string;
}) => Promise<GitHubAppInstallationToken>;

type ReviewPipelineRunner = (input: RunReviewPipelineInput) => Promise<ReviewResult>;

export type ReviewJobLike = {
  data: ReviewJobData;
  log?: (message: string) => unknown;
};

export type CreateReviewProcessorOptions = {
  appId: string | undefined;
  createInstallationToken?: InstallationTokenFactory;
  privateKey: string | undefined;
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

    await job.log?.(`Completed review run ${data.reviewRunId}`);

    return {
      findings: result.findings.length,
      reviewRunId: data.reviewRunId,
    };
  };
}
