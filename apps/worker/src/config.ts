import { z } from "zod";

const WorkerEnvSchema = z.object({
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  DIFFGUARD_REVIEW_PASSES: z.string().min(1).optional(),
  DIFFGUARD_VALIDATOR_MODEL: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_RESOLUTION_MODEL: z.string().min(1).optional(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  REVIEW_QUEUE_NAME: z.string().min(1).default("diffguard-review-runs")
});

export type WorkerConfig = {
  diffguardValidatorModel?: string;
  githubAppId?: string;
  githubAppPrivateKey?: string;
  openaiApiKey?: string;
  openaiResolutionModel?: string;
  reviewPasses?: string;
  redisUrl: string;
  queueName: string;
};

export function createWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const parsed = WorkerEnvSchema.parse(env);

  return {
    diffguardValidatorModel: parsed.DIFFGUARD_VALIDATOR_MODEL,
    githubAppId: parsed.GITHUB_APP_ID,
    githubAppPrivateKey: parsed.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    openaiApiKey: parsed.OPENAI_API_KEY,
    openaiResolutionModel: parsed.OPENAI_RESOLUTION_MODEL,
    reviewPasses: parsed.DIFFGUARD_REVIEW_PASSES,
    redisUrl: parsed.REDIS_URL,
    queueName: parsed.REVIEW_QUEUE_NAME
  };
}
