import { z } from "zod";

const WorkerEnvSchema = z.object({
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  REVIEW_QUEUE_NAME: z.string().min(1).default("diffguard-review-runs")
});

export type WorkerConfig = {
  githubAppId?: string;
  githubAppPrivateKey?: string;
  redisUrl: string;
  queueName: string;
};

export function createWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const parsed = WorkerEnvSchema.parse(env);

  return {
    githubAppId: parsed.GITHUB_APP_ID,
    githubAppPrivateKey: parsed.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    redisUrl: parsed.REDIS_URL,
    queueName: parsed.REVIEW_QUEUE_NAME
  };
}
