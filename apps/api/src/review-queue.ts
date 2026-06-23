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
  getDepth?(): Promise<number>;
  getJobCounts?(): Promise<{ failed: number; succeeded: number }>;
  ping?(): Promise<void>;
};

export function createBullMqReviewQueue(env: NodeJS.ProcessEnv = process.env): ReviewQueue {
  const parsed = QueueEnvSchema.parse(env);
  const redisUrl = new URL(parsed.REDIS_URL);

  const queue = new Queue<ReviewJobData>(parsed.REVIEW_QUEUE_NAME, {
    connection: {
      host: redisUrl.hostname,
      password: redisUrl.password || undefined,
      port: redisUrl.port ? Number(redisUrl.port) : 6379,
      username: redisUrl.username || undefined,
    },
  });

  return {
    add: (name, data, options) => queue.add(name, data, options),
    getDepth: () => queue.count(),
    getJobCounts: async () => {
      const counts = await queue.getJobCounts("completed", "failed");

      return {
        failed: counts.failed ?? 0,
        succeeded: counts.completed ?? 0,
      };
    },
    ping: async () => {
      await queue.count();
    },
  };
}
