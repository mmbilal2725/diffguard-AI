import { timingSafeEqual } from "node:crypto";

import { REVIEW_QUEUE_JOB_NAME, type ReviewJobData } from "@diffguard/shared";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import { createPrismaDashboardStore, type DashboardStore } from "./dashboard-store.js";
import { toReviewWebhookRequest, readWebhookAction } from "./github-webhook.js";
import { createBullMqReviewQueue, type ReviewQueue } from "./review-queue.js";
import { verifyGitHubWebhookSignature } from "./webhook-signature.js";
import { createPrismaWebhookStore, type WebhookStore } from "./webhook-store.js";

export type RateLimitOptions = {
  maxRequests: number;
  windowMs: number;
};

export type BuildApiServerOptions = {
  allowedOrigins?: string[];
  dashboardApiKey?: string;
  dashboardStore?: DashboardStore;
  rateLimit?: RateLimitOptions;
  reviewQueue?: ReviewQueue;
  store?: WebhookStore;
  webhookSecret?: string;
};

const ReviewRunStatusSchema = z.enum([
  "queued",
  "analyzing",
  "validating",
  "completed",
  "failed",
  "skipped",
]);

const ValidatorDecisionSchema = z.enum(["accepted", "rejected", "deduplicated"]);
const GitHubCommentStatusSchema = z.enum(["posted", "skipped", "pending", "failed"]);
const FindingSeveritySchema = z.enum(["critical", "high", "medium"]);

const DashboardFindingSchema = z
  .object({
    confidence: z.number(),
    file: z.string(),
    id: z.string(),
    line: z.number().int(),
    severity: FindingSeveritySchema,
    status: GitHubCommentStatusSchema,
    summary: z.string(),
    title: z.string(),
  })
  .strict();

const DashboardReviewRunSchema = z
  .object({
    candidatesCount: z.number().int().nonnegative(),
    confidenceThreshold: z.number(),
    costUsd: z.number(),
    createdAt: z.string(),
    findings: z.array(DashboardFindingSchema),
    findingsCount: z.number().int().nonnegative(),
    githubCommentStatus: GitHubCommentStatusSchema,
    id: z.string(),
    latencySeconds: z.number(),
    modelCalls: z.array(
      z
        .object({
          costUsd: z.number(),
          id: z.string(),
          inputTokens: z.number().int().nonnegative(),
          latencyMs: z.number().int().nonnegative(),
          model: z.string(),
          outputTokens: z.number().int().nonnegative(),
          purpose: z.string(),
        })
        .strict(),
    ),
    prNumber: z.number().int().positive(),
    repo: z.string(),
    status: ReviewRunStatusSchema,
    title: z.string(),
    validatorDecisions: z.array(
      z
        .object({
          confidence: z.number(),
          decision: ValidatorDecisionSchema,
          finding: z.string(),
          id: z.string(),
          reason: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

const DashboardRepositorySchema = z
  .object({
    confidenceThreshold: z.number(),
    enabled: z.boolean(),
    id: z.string(),
    installation: z.string(),
    lastReviewedAt: z.string(),
    maxFindingsPerPr: z.number().int().positive(),
    repo: z.string(),
    rulesPath: z.string(),
  })
  .strict();

const DashboardEvalSummarySchema = z
  .object({
    cases: z.number().int().nonnegative(),
    costUsd: z.number(),
    createdAt: z.string(),
    falseNegatives: z.number().int().nonnegative(),
    falsePositives: z.number().int().nonnegative(),
    id: z.string(),
    name: z.string(),
    precision: z.number(),
    recall: z.number(),
  })
  .strict();

const DashboardMetricsSchema = z
  .object({
    averageLatencySeconds: z.number(),
    estimatedResolutionRate: z.number(),
    falsePositiveFindings: z.number().int().nonnegative(),
    findingsPosted: z.number().int().nonnegative(),
    resolvedFindings: z.number().int().nonnegative(),
    totalCostUsd: z.number(),
    totalPrsReviewed: z.number().int().nonnegative(),
    unknownFindings: z.number().int().nonnegative(),
    unresolvedFindings: z.number().int().nonnegative(),
    validatorRejectionRate: z.number(),
  })
  .strict();

const ReviewTrendPointSchema = z
  .object({
    cost: z.number(),
    day: z.string(),
    findings: z.number().int().nonnegative(),
    latency: z.number(),
    prs: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  })
  .strict();

const DashboardOverviewResponseSchema = z
  .object({
    metrics: DashboardMetricsSchema,
    reviewTrend: z.array(ReviewTrendPointSchema),
  })
  .strict();

const DashboardReviewRunsResponseSchema = z
  .object({
    reviewRuns: z.array(DashboardReviewRunSchema),
  })
  .strict();

const DashboardReviewRunResponseSchema = z
  .object({
    reviewRun: DashboardReviewRunSchema,
  })
  .strict();

const DashboardRepositoriesResponseSchema = z
  .object({
    repositories: z.array(DashboardRepositorySchema),
  })
  .strict();

const DashboardFindingsResponseSchema = z
  .object({
    findings: z.array(DashboardFindingSchema),
  })
  .strict();

const DashboardEvalsResponseSchema = z
  .object({
    evals: z.array(DashboardEvalSummarySchema),
  })
  .strict();

export function buildApiServer(options: BuildApiServerOptions = {}): FastifyInstance {
  const server = Fastify({
    logger: false
  });
  let defaultReviewQueue: ReviewQueue | undefined;
  let defaultDashboardStore: DashboardStore | undefined;
  let defaultStore: WebhookStore | undefined;
  const rateLimitState = new Map<string, { count: number; resetAt: number }>();

  server.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  server.addHook("onRequest", async (request, reply) => {
    const rateLimit = readRateLimitOptions(options);
    const rateLimitResult = checkRateLimit({
      now: Date.now(),
      rateLimit,
      state: rateLimitState,
      clientId: readClientId(request),
    });

    reply.header("x-ratelimit-limit", String(rateLimit.maxRequests));
    reply.header("x-ratelimit-remaining", String(rateLimitResult.remaining));
    reply.header("x-ratelimit-reset", String(Math.ceil(rateLimitResult.resetAt / 1000)));

    if (!rateLimitResult.allowed) {
      return reply
        .code(429)
        .header("retry-after", String(Math.ceil(rateLimitResult.retryAfterMs / 1000)))
        .send({ error: "Rate limit exceeded." });
    }
  });

  server.addHook("onRequest", async (request, reply) => {
    const originResult = validateOrigin(request, readAllowedOrigins(options));
    if (!originResult.allowed) {
      return reply.code(403).send({ error: "Origin is not allowed." });
    }

    if (originResult.origin !== undefined) {
      setCorsHeaders(reply, originResult.origin, request);
    }

    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  server.get("/health", async () => {
    return { status: "ok" };
  });

  server.get("/dashboard/overview", async (request, reply) => {
    const authorized = requireDashboardApiKey(request, reply, readDashboardApiKey(options));
    if (authorized !== true) {
      return authorized;
    }

    const dashboardStore =
      options.dashboardStore ?? (defaultDashboardStore ??= await createDefaultDashboardStore());
    return sendValidatedDashboardResponse(reply, DashboardOverviewResponseSchema, await dashboardStore.getOverview());
  });

  server.get("/dashboard/review-runs", async (request, reply) => {
    const authorized = requireDashboardApiKey(request, reply, readDashboardApiKey(options));
    if (authorized !== true) {
      return authorized;
    }

    const dashboardStore =
      options.dashboardStore ?? (defaultDashboardStore ??= await createDefaultDashboardStore());
    return sendValidatedDashboardResponse(reply, DashboardReviewRunsResponseSchema, {
      reviewRuns: await dashboardStore.listReviewRuns(),
    });
  });

  server.get<{ Params: { id: string } }>("/dashboard/review-runs/:id", async (request, reply) => {
    const authorized = requireDashboardApiKey(request, reply, readDashboardApiKey(options));
    if (authorized !== true) {
      return authorized;
    }

    const dashboardStore =
      options.dashboardStore ?? (defaultDashboardStore ??= await createDefaultDashboardStore());
    const reviewRun = await dashboardStore.getReviewRun(request.params.id);

    if (reviewRun === null) {
      return reply.code(404).send({ error: "Review run not found." });
    }

    return sendValidatedDashboardResponse(reply, DashboardReviewRunResponseSchema, { reviewRun });
  });

  server.get("/dashboard/repositories", async (request, reply) => {
    const authorized = requireDashboardApiKey(request, reply, readDashboardApiKey(options));
    if (authorized !== true) {
      return authorized;
    }

    const dashboardStore =
      options.dashboardStore ?? (defaultDashboardStore ??= await createDefaultDashboardStore());
    return sendValidatedDashboardResponse(reply, DashboardRepositoriesResponseSchema, {
      repositories: await dashboardStore.listRepositories(),
    });
  });

  server.get("/dashboard/findings", async (request, reply) => {
    const authorized = requireDashboardApiKey(request, reply, readDashboardApiKey(options));
    if (authorized !== true) {
      return authorized;
    }

    const dashboardStore =
      options.dashboardStore ?? (defaultDashboardStore ??= await createDefaultDashboardStore());
    return sendValidatedDashboardResponse(reply, DashboardFindingsResponseSchema, {
      findings: await dashboardStore.listFindings(),
    });
  });

  server.get("/dashboard/evals", async (request, reply) => {
    const authorized = requireDashboardApiKey(request, reply, readDashboardApiKey(options));
    if (authorized !== true) {
      return authorized;
    }

    const dashboardStore =
      options.dashboardStore ?? (defaultDashboardStore ??= await createDefaultDashboardStore());
    return sendValidatedDashboardResponse(reply, DashboardEvalsResponseSchema, {
      evals: await dashboardStore.listEvalSummaries(),
    });
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

function readClientId(request: FastifyRequest): string {
  const forwardedFor = readHeader(request, "x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const realIp = readHeader(request, "x-real-ip")?.trim();

  return forwardedFor || realIp || request.ip;
}

function sendValidatedDashboardResponse<T>(
  reply: FastifyReply,
  schema: z.ZodType<T>,
  data: unknown,
): T | FastifyReply {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return reply.code(500).send({ error: "Dashboard response failed validation." });
  }

  return parsed.data;
}

function readAllowedOrigins(options: BuildApiServerOptions): string[] {
  if (options.allowedOrigins !== undefined) {
    return options.allowedOrigins;
  }

  return splitCsv(process.env.DIFFGUARD_ALLOWED_ORIGINS);
}

function readRateLimitOptions(options: BuildApiServerOptions): RateLimitOptions {
  if (options.rateLimit !== undefined) {
    return options.rateLimit;
  }

  return {
    maxRequests: readPositiveInteger(process.env.DIFFGUARD_RATE_LIMIT_MAX_REQUESTS, 120),
    windowMs: readPositiveInteger(process.env.DIFFGUARD_RATE_LIMIT_WINDOW_MS, 60_000),
  };
}

function validateOrigin(
  request: FastifyRequest,
  allowedOrigins: string[]
): { allowed: true; origin?: string } | { allowed: false } {
  const origin = readHeader(request, "origin");
  if (origin === undefined) {
    return { allowed: true };
  }

  if (allowedOrigins.includes(origin)) {
    return { allowed: true, origin };
  }

  return { allowed: false };
}

function setCorsHeaders(reply: FastifyReply, origin: string, request: FastifyRequest): void {
  reply.header("access-control-allow-origin", origin);
  reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
  reply.header(
    "access-control-allow-headers",
    readHeader(request, "access-control-request-headers") ??
      "authorization,content-type,x-diffguard-api-key,x-github-delivery,x-github-event,x-hub-signature-256"
  );
  reply.header("access-control-max-age", "600");
  reply.header("vary", "Origin");
}

function checkRateLimit(input: {
  now: number;
  rateLimit: RateLimitOptions;
  state: Map<string, { count: number; resetAt: number }>;
  clientId: string;
}): { allowed: true; remaining: number; resetAt: number } | {
  allowed: false;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
} {
  const existing = input.state.get(input.clientId);
  const current =
    existing === undefined || existing.resetAt <= input.now
      ? { count: 0, resetAt: input.now + input.rateLimit.windowMs }
      : existing;

  if (current.count >= input.rateLimit.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterMs: Math.max(current.resetAt - input.now, 0),
    };
  }

  current.count += 1;
  input.state.set(input.clientId, current);

  return {
    allowed: true,
    remaining: Math.max(input.rateLimit.maxRequests - current.count, 0),
    resetAt: current.resetAt,
  };
}

function splitCsv(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readDashboardApiKey(options: BuildApiServerOptions): string | undefined {
  return options.dashboardApiKey ?? process.env.DIFFGUARD_DASHBOARD_API_KEY;
}

function requireDashboardApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
  configuredApiKey: string | undefined
): true | FastifyReply {
  if (configuredApiKey === undefined || configuredApiKey.trim() === "") {
    return reply.code(500).send({ error: "Dashboard API key is not configured." });
  }

  const credential = readDashboardCredential(request);
  if (credential === undefined || !secureStringEqual(credential, configuredApiKey)) {
    return reply.code(401).send({ error: "Invalid dashboard API credentials." });
  }

  return true;
}

function readDashboardCredential(request: FastifyRequest): string | undefined {
  const apiKeyHeader = readHeader(request, "x-diffguard-api-key");
  if (apiKeyHeader !== undefined) {
    return apiKeyHeader;
  }

  const authorization = readHeader(request, "authorization");
  const bearerPrefix = "Bearer ";
  if (authorization?.startsWith(bearerPrefix)) {
    return authorization.slice(bearerPrefix.length);
  }

  return undefined;
}

function secureStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
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

async function createDefaultDashboardStore(): Promise<DashboardStore> {
  const { createDatabaseClient } = await import("@diffguard/database");
  return createPrismaDashboardStore(createDatabaseClient() as never);
}
