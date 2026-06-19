import { Worker } from "bullmq";
import { type ReviewJobData } from "@diffguard/shared";

import { createWorkerConfig } from "./config.js";
import { createReviewProcessor } from "./review-processor.js";

const config = createWorkerConfig(process.env);
const redisUrl = new URL(config.redisUrl);
const connection = {
  host: redisUrl.hostname,
  port: redisUrl.port ? Number(redisUrl.port) : 6379,
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null
};

const worker = new Worker<ReviewJobData>(
  config.queueName,
  createReviewProcessor({
    appId: config.githubAppId,
    privateKey: config.githubAppPrivateKey,
  }),
  { connection },
);

worker.on("completed", (job) => {
  console.info({ jobId: job.id }, "Review job completed");
});

worker.on("failed", (job, error) => {
  console.error({ jobId: job?.id, error: error.message }, "Review job failed");
});

console.info({ queueName: config.queueName }, "DiffGuard worker started");
