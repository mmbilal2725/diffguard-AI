import { Worker } from "bullmq";

import { createWorkerConfig } from "./config.js";

type ReviewRunJob = {
  reviewRunId: string;
};

const config = createWorkerConfig(process.env);
const redisUrl = new URL(config.redisUrl);
const connection = {
  host: redisUrl.hostname,
  port: redisUrl.port ? Number(redisUrl.port) : 6379,
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null
};

const worker = new Worker<ReviewRunJob>(
  config.queueName,
  async (job) => {
    job.log(`Received review run ${job.data.reviewRunId}`);
  },
  { connection },
);

worker.on("completed", (job) => {
  console.info({ jobId: job.id }, "Review job completed");
});

worker.on("failed", (job, error) => {
  console.error({ jobId: job?.id, error: error.message }, "Review job failed");
});

console.info({ queueName: config.queueName }, "DiffGuard worker started");
