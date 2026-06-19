import type { REVIEW_QUEUE_JOB_NAME, ReviewJobData } from "@diffguard/shared";
import { Queue } from "bullmq";
import { z } from "zod";

const QueueEnvSchema = z.object({
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  REVIEW_QUEUE_NAME: z.string().min(1).default("diffguard-review-runs"),
});

export type ReviewQueue = {
  add(
    name: typeof REVIEW_QUEUE_JOB_NAME,
    data: ReviewJobData,
    options: {
      jobId: string;
      removeOnComplete: { age: number; count: number };
      removeOnFail: { age: number; count: number };
    },
  ): Promise<unknown>;
};

export function createBullMqReviewQueue(env: NodeJS.ProcessEnv = process.env): ReviewQueue {
  const parsed = QueueEnvSchema.parse(env);
  const redisUrl = new URL(parsed.REDIS_URL);

  return new Queue<ReviewJobData>(parsed.REVIEW_QUEUE_NAME, {
    connection: {
      host: redisUrl.hostname,
      password: redisUrl.password || undefined,
      port: redisUrl.port ? Number(redisUrl.port) : 6379,
      username: redisUrl.username || undefined,
    },
  });
}
