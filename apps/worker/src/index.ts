import { Worker } from "bullmq";
import { createDatabaseClient } from "@diffguard/database";
import { createOpenAIProvider, validateFindingResolutionWithLlm } from "@diffguard/llm";
import { type ReviewJobData } from "@diffguard/shared";

import { createWorkerConfig } from "./config.js";
import { createReviewProcessor } from "./review-processor.js";
import { createPrismaResolutionStore } from "./resolution-store.js";

const config = createWorkerConfig(process.env);
const redisUrl = new URL(config.redisUrl);
const connection = {
  host: redisUrl.hostname,
  port: redisUrl.port ? Number(redisUrl.port) : 6379,
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null
};
const resolutionStore =
  process.env.DATABASE_URL === undefined
    ? undefined
    : createPrismaResolutionStore(createDatabaseClient() as never);
const resolutionProvider =
  config.openaiApiKey === undefined
    ? undefined
    : createOpenAIProvider({
        apiKey: config.openaiApiKey,
        model: config.openaiResolutionModel,
      });

const worker = new Worker<ReviewJobData>(
  config.queueName,
  createReviewProcessor({
    appId: config.githubAppId,
    privateKey: config.githubAppPrivateKey,
    resolutionStore,
    resolutionValidator:
      resolutionProvider === undefined
        ? undefined
        : (input) =>
            validateFindingResolutionWithLlm({
              ...input,
              model: config.openaiResolutionModel,
              provider: resolutionProvider,
              providerName: "openai",
            }),
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
