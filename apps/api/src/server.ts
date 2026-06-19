import { REVIEW_QUEUE_JOB_NAME, type ReviewJobData } from "@diffguard/shared";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { toReviewWebhookRequest, readWebhookAction } from "./github-webhook.js";
import { createBullMqReviewQueue, type ReviewQueue } from "./review-queue.js";
import { verifyGitHubWebhookSignature } from "./webhook-signature.js";
import { createPrismaWebhookStore, type WebhookStore } from "./webhook-store.js";

export type BuildApiServerOptions = {
  reviewQueue?: ReviewQueue;
  store?: WebhookStore;
  webhookSecret?: string;
};

export function buildApiServer(options: BuildApiServerOptions = {}): FastifyInstance {
  const server = Fastify({
    logger: false
  });
  let defaultReviewQueue: ReviewQueue | undefined;
  let defaultStore: WebhookStore | undefined;

  server.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  server.get("/health", async () => {
    return { status: "ok" };
  });

  server.post("/webhooks/github", async (request, reply) => {
    const webhookSecret = options.webhookSecret ?? process.env.GITHUB_WEBHOOK_SECRET;
    if (webhookSecret === undefined || webhookSecret.trim() === "") {
      return reply.code(500).send({ error: "GitHub webhook secret is not configured." });
    }

    const payloadText = readRawPayload(request);
    const signature = readHeader(request, "x-hub-signature-256");
    if (
      !verifyGitHubWebhookSignature({
        payload: payloadText,
        secret: webhookSecret,
        signature,
      })
    ) {
      return reply.code(401).send({ error: "Invalid GitHub webhook signature." });
    }

    const eventName = readHeader(request, "x-github-event");
    const deliveryId = readHeader(request, "x-github-delivery");
    if (eventName === undefined || deliveryId === undefined) {
      return reply.code(400).send({ error: "Missing GitHub webhook headers." });
    }

    const payload = parseJsonPayload(payloadText);
    if (!payload.ok) {
      return reply.code(400).send({ error: "Invalid JSON webhook payload." });
    }

    const store = options.store ?? (defaultStore ??= await createDefaultWebhookStore());
    const delivery = await store.recordDelivery({
      action: readWebhookAction(payload.data),
      deliveryId,
      eventName,
    });
    if (delivery.duplicate) {
      return reply.code(202).send({ status: "duplicate" });
    }

    const reviewRequest = toReviewWebhookRequest(eventName, payload.data);
    if (reviewRequest === null) {
      return reply.code(202).send({ status: "ignored" });
    }

    const repository = await store.upsertRepositoryInstallation({
      defaultBranch: reviewRequest.defaultBranch,
      installationId: reviewRequest.installationId,
      name: reviewRequest.repo,
      owner: reviewRequest.owner,
    });
    const pullRequest = await store.upsertPullRequest({
      authorLogin: reviewRequest.pullRequestAuthorLogin,
      baseSha: reviewRequest.baseSha,
      headSha: reviewRequest.headSha,
      number: reviewRequest.pullNumber,
      repositoryId: repository.repositoryId,
      status: reviewRequest.pullRequestStatus,
      title: reviewRequest.pullRequestTitle,
    });
    const reviewRun = await store.createReviewRun({
      pullRequestId: pullRequest.pullRequestId,
      trigger: reviewRequest.trigger,
    });
    const reviewQueue = options.reviewQueue ?? (defaultReviewQueue ??= createBullMqReviewQueue());
    const jobData: ReviewJobData = {
      deliveryId,
      ...(reviewRequest.headSha === undefined ? {} : { headSha: reviewRequest.headSha }),
      installationId: reviewRequest.installationId,
      owner: reviewRequest.owner,
      pullNumber: reviewRequest.pullNumber,
      repo: reviewRequest.repo,
      reviewRunId: reviewRun.reviewRunId,
      trigger: reviewRequest.trigger,
    };

    await reviewQueue.add(REVIEW_QUEUE_JOB_NAME, jobData, {
      jobId: `${deliveryId}:${reviewRun.reviewRunId}`,
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 5000 },
    });

    return reply.code(202).send({ reviewRunId: reviewRun.reviewRunId, status: "queued" });
  });

  return server;
}

function readRawPayload(request: FastifyRequest): string {
  return typeof request.body === "string" ? request.body : "";
}

function readHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function parseJsonPayload(payload: string): { ok: true; data: unknown } | { ok: false } {
  try {
    return { ok: true, data: JSON.parse(payload) as unknown };
  } catch {
    return { ok: false };
  }
}

async function createDefaultWebhookStore(): Promise<WebhookStore> {
  const { createDatabaseClient } = await import("@diffguard/database");
  return createPrismaWebhookStore(createDatabaseClient() as never);
}
