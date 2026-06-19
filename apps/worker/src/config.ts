import { z } from "zod";

const WorkerEnvSchema = z.object({
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  REVIEW_QUEUE_NAME: z.string().min(1).default("diffguard-review-runs")
});

export type WorkerConfig = {
  redisUrl: string;
  queueName: string;
};

export function createWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const parsed = WorkerEnvSchema.parse(env);

  return {
    redisUrl: parsed.REDIS_URL,
    queueName: parsed.REVIEW_QUEUE_NAME
  };
}
