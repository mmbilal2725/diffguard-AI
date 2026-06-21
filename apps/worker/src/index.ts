import { Worker } from "bullmq";
import { createDatabaseClient } from "@diffguard/database";
import { validateFindingResolutionWithLlm } from "@diffguard/llm";
import {
  loadPostedFindingDedupeKeysFromDatabase,
  markReviewRunFailedInDatabase,
  storeReviewRunInDatabase,
} from "@diffguard/review-run";
import { type ReviewJobData } from "@diffguard/shared";

import { createWorkerConfig } from "./config.js";
import { createWorkerLlmReviewer } from "./review-llm.js";
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
const reviewRunPersistence =
  process.env.DATABASE_URL === undefined
    ? {}
    : {
        loadPostedFindingDedupeKeys: (ref: { owner: string; repo: string; number: number }) =>
          loadPostedFindingDedupeKeysFromDatabase({ ref }),
        markReviewRunFailed: (input: { reviewRunId: string }) =>
          markReviewRunFailedInDatabase({ reviewRunId: input.reviewRunId }),
        storeReviewRun: storeReviewRunInDatabase,
      };
const llmSetup = createWorkerLlmReviewer({
  apiKey: config.openaiApiKey,
  model: config.openaiResolutionModel,
  reviewPasses: config.reviewPasses,
});
const llmProvider = llmSetup.provider;

for (const warning of llmSetup.warnings) {
  console.warn({ warning }, "DiffGuard LLM reviewer disabled");
}

const worker = new Worker<ReviewJobData>(
  config.queueName,
  createReviewProcessor({
    appId: config.githubAppId,
    privateKey: config.githubAppPrivateKey,
    ...(llmSetup.llmReviewer === undefined ? {} : { llmReviewer: llmSetup.llmReviewer }),
    ...reviewRunPersistence,
    resolutionStore,
    resolutionValidator:
      llmProvider === undefined
        ? undefined
        : (input) =>
            validateFindingResolutionWithLlm({
              ...input,
              model: config.openaiResolutionModel,
              provider: llmProvider,
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
