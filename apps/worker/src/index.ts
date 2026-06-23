import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { createDatabaseClient } from "@diffguard/database";
import { validateFindingResolutionWithLlm } from "@diffguard/llm";
import {
  loadPostedFindingDedupeKeysFromDatabase,
  markReviewRunFailedInDatabase,
  storeReviewRunInDatabase,
} from "@diffguard/review-run";
import { createJsonLogger, toErrorLogFields, type ReviewJobData } from "@diffguard/shared";

import { createWorkerConfig } from "./config.js";
import { startWorkerHealthServer, type WorkerHealthMetrics } from "./health-server.js";
import { createWorkerLlmReviewer } from "./review-llm.js";
import { createReviewProcessor } from "./review-processor.js";
import { createPrismaResolutionStore } from "./resolution-store.js";

const config = createWorkerConfig(process.env);
const logger = createJsonLogger({
  service: "diffguard-worker",
  sink: (line) => process.stderr.write(`${line}\n`),
});
const redisUrl = new URL(config.redisUrl);
const connection = {
  host: redisUrl.hostname,
  port: redisUrl.port ? Number(redisUrl.port) : 6379,
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null
};
const healthRedis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
});
const metrics: WorkerHealthMetrics = {
  jobFailureCount: 0,
  jobSuccessCount: 0,
  modelCostUsd: 0,
  reviewDurationMs: 0,
  validatorRejectionRate: 0,
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
        markReviewRunFailed: (input: { error: unknown; reviewRunId: string }) =>
          markReviewRunFailedInDatabase({ error: input.error, reviewRunId: input.reviewRunId }),
        storeReviewRun: storeReviewRunInDatabase,
      };
const llmSetup = createWorkerLlmReviewer({
  apiKey: config.openaiApiKey,
  model: config.openaiResolutionModel,
  reviewPasses: config.reviewPasses,
  validatorModel: config.diffguardValidatorModel ?? config.openaiResolutionModel,
});
const llmProvider = llmSetup.provider;

for (const warning of llmSetup.warnings) {
  logger.warn({ status: "disabled", warning }, "worker.llm_reviewer.disabled");
}

const worker = new Worker<ReviewJobData>(
  config.queueName,
  createReviewProcessor({
    appId: config.githubAppId,
    privateKey: config.githubAppPrivateKey,
    ...(llmSetup.findingValidator === undefined
      ? {}
      : { findingValidator: llmSetup.findingValidator }),
    ...(llmSetup.llmReviewer === undefined ? {} : { llmReviewer: llmSetup.llmReviewer }),
    logger,
    onReviewCompleted: (summary) => {
      metrics.modelCostUsd += summary.estimatedCostUsd;
      metrics.reviewDurationMs = summary.durationMs ?? metrics.reviewDurationMs;
      metrics.validatorRejectionRate = summary.validatorRejectionRate;
    },
    ...reviewRunPersistence,
    resolutionStore,
    staticChecksEnabled: config.staticChecksEnabled,
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
  metrics.jobSuccessCount += 1;
  logger.info(
    {
      jobId: job.id,
      status: "completed",
    },
    "worker.queue_job.completed",
  );
});

worker.on("failed", (job, error) => {
  metrics.jobFailureCount += 1;
  logger.error(
    {
      jobId: job?.id,
      ...toErrorLogFields(error),
      status: "failed",
    },
    "worker.queue_job.failed",
  );
});

startWorkerHealthServer({
  logger,
  metrics: () => metrics,
  port: config.workerHealthPort,
  readiness: async () => {
    await healthRedis.ping();

    return worker.isRunning();
  },
});

logger.info({ queueName: config.queueName, status: "started" }, "worker.started");
