import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { DashboardStore } from "./dashboard-store.js";
import { buildApiServer } from "./server.js";

const WEBHOOK_SECRET = "test-webhook-secret";
const DASHBOARD_API_KEY = "test-dashboard-api-key";

describe("buildApiServer", () => {
  it("returns ok from the health endpoint", async () => {
    const server = buildApiServer();

    const response = await server.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });

    await server.close();
  });

  it("serves dashboard API data from the configured dashboard store", async () => {
    const dashboardStore = createDashboardStore();
    const server = buildApiServer({ dashboardApiKey: DASHBOARD_API_KEY, dashboardStore });

    const overview = await server.inject({
      headers: dashboardAuthHeaders(),
      method: "GET",
      url: "/dashboard/overview",
    });
    const reviewRuns = await server.inject({
      headers: dashboardAuthHeaders(),
      method: "GET",
      url: "/dashboard/review-runs",
    });
    const reviewRun = await server.inject({
      headers: dashboardAuthHeaders(),
      method: "GET",
      url: "/dashboard/review-runs/rvw_live",
    });
    const repositories = await server.inject({
      headers: dashboardAuthHeaders(),
      method: "GET",
      url: "/dashboard/repositories",
    });
    const findings = await server.inject({
      headers: dashboardAuthHeaders(),
      method: "GET",
      url: "/dashboard/findings",
    });
    const evals = await server.inject({
      headers: dashboardAuthHeaders(),
      method: "GET",
      url: "/dashboard/evals",
    });

    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toEqual({
      metrics: dashboardOverview.metrics,
      reviewTrend: dashboardOverview.reviewTrend,
    });
    expect(reviewRuns.statusCode).toBe(200);
    expect(reviewRuns.json()).toEqual({ reviewRuns: [dashboardReviewRun] });
    expect(reviewRun.statusCode).toBe(200);
    expect(reviewRun.json()).toEqual({ reviewRun: dashboardReviewRun });
    expect(repositories.statusCode).toBe(200);
    expect(repositories.json()).toEqual({ repositories: [dashboardRepository] });
    expect(findings.statusCode).toBe(200);
    expect(findings.json()).toEqual({ findings: dashboardReviewRun.findings });
    expect(evals.statusCode).toBe(200);
    expect(evals.json()).toEqual({ evals: [dashboardEval] });

    await server.close();
  });

  it("accepts the dashboard API key through the x-diffguard-api-key header", async () => {
    const server = buildApiServer({
      dashboardApiKey: DASHBOARD_API_KEY,
      dashboardStore: createDashboardStore(),
    });

    const response = await server.inject({
      headers: { "x-diffguard-api-key": DASHBOARD_API_KEY },
      method: "GET",
      url: "/dashboard/overview",
    });

    expect(response.statusCode).toBe(200);

    await server.close();
  });

  it("rejects dashboard API requests without a configured API key", async () => {
    const server = buildApiServer({ dashboardStore: createDashboardStore() });

    const response = await server.inject({
      method: "GET",
      url: "/dashboard/overview",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Dashboard API key is not configured." });

    await server.close();
  });

  it("rejects dashboard API requests with missing or invalid credentials", async () => {
    const server = buildApiServer({
      dashboardApiKey: DASHBOARD_API_KEY,
      dashboardStore: createDashboardStore(),
    });

    const missing = await server.inject({
      method: "GET",
      url: "/dashboard/overview",
    });
    const invalid = await server.inject({
      headers: { authorization: "Bearer wrong-key" },
      method: "GET",
      url: "/dashboard/overview",
    });

    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({ error: "Invalid dashboard API credentials." });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toEqual({ error: "Invalid dashboard API credentials." });

    await server.close();
  });

  it("returns not found for an unknown dashboard review run", async () => {
    const server = buildApiServer({
      dashboardApiKey: DASHBOARD_API_KEY,
      dashboardStore: createDashboardStore(),
    });

    const response = await server.inject({
      headers: dashboardAuthHeaders(),
      method: "GET",
      url: "/dashboard/review-runs/missing",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Review run not found." });

    await server.close();
  });

  it("accepts a valid signed webhook", async () => {
    const dependencies = createWebhookDependencies();
    const server = buildApiServer({
      reviewQueue: dependencies.reviewQueue,
      store: dependencies.store,
      webhookSecret: WEBHOOK_SECRET,
    });
    const payload = JSON.stringify({
      hook_id: 123,
      zen: "Avoid noisy review comments.",
    });

    const response = await server.inject({
      headers: signedHeaders({
        deliveryId: "delivery-valid",
        eventName: "ping",
        payload,
      }),
      method: "POST",
      payload,
      url: "/webhooks/github",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "ignored" });
    expect(dependencies.store.recordDelivery).toHaveBeenCalledWith({
      action: undefined,
      deliveryId: "delivery-valid",
      eventName: "ping",
    });

    await server.close();
  });

  it("rejects a webhook with an invalid signature", async () => {
    const dependencies = createWebhookDependencies();
    const server = buildApiServer({
      reviewQueue: dependencies.reviewQueue,
      store: dependencies.store,
      webhookSecret: WEBHOOK_SECRET,
    });
    const payload = JSON.stringify(createPullRequestPayload("opened"));

    const response = await server.inject({
      headers: {
        "content-type": "application/json",
        "x-github-delivery": "delivery-invalid-signature",
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=bad",
      },
      method: "POST",
      payload,
      url: "/webhooks/github",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Invalid GitHub webhook signature." });
    expect(dependencies.store.recordDelivery).not.toHaveBeenCalled();
    expect(dependencies.reviewQueue.add).not.toHaveBeenCalled();

    await server.close();
  });

  it("ignores unsupported webhook events", async () => {
    const dependencies = createWebhookDependencies();
    const server = buildApiServer({
      reviewQueue: dependencies.reviewQueue,
      store: dependencies.store,
      webhookSecret: WEBHOOK_SECRET,
    });
    const payload = JSON.stringify({ ref: "refs/heads/main" });

    const response = await server.inject({
      headers: signedHeaders({
        deliveryId: "delivery-unsupported",
        eventName: "push",
        payload,
      }),
      method: "POST",
      payload,
      url: "/webhooks/github",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "ignored" });
    expect(dependencies.reviewQueue.add).not.toHaveBeenCalled();

    await server.close();
  });

  it("enqueues a review for supported pull_request events", async () => {
    const dependencies = createWebhookDependencies();
    const server = buildApiServer({
      reviewQueue: dependencies.reviewQueue,
      store: dependencies.store,
      webhookSecret: WEBHOOK_SECRET,
    });
    const payload = JSON.stringify(createPullRequestPayload("synchronize"));

    const response = await server.inject({
      headers: signedHeaders({
        deliveryId: "delivery-pr",
        eventName: "pull_request",
        payload,
      }),
      method: "POST",
      payload,
      url: "/webhooks/github",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ reviewRunId: "review_run_1", status: "queued" });
    expect(dependencies.store.upsertRepositoryInstallation).toHaveBeenCalledWith({
      defaultBranch: "main",
      installationId: "98765",
      name: "widgets",
      owner: "acme",
    });
    expect(dependencies.store.upsertPullRequest).toHaveBeenCalledWith({
      authorLogin: "octocat",
      baseSha: "base-sha",
      headSha: "head-sha",
      number: 42,
      repositoryId: "repository_1",
      status: "OPEN",
      title: "Fix checkout",
    });
    expect(dependencies.store.createReviewRun).toHaveBeenCalledWith({
      pullRequestId: "pull_request_1",
      trigger: "pull_request.synchronize",
    });
    expect(dependencies.reviewQueue.add).toHaveBeenCalledWith(
      "review-pr",
      {
        deliveryId: "delivery-pr",
        headSha: "head-sha",
        installationId: "98765",
        owner: "acme",
        pullNumber: 42,
        repo: "widgets",
        reviewRunId: "review_run_1",
        trigger: "pull_request.synchronize",
      },
      expect.objectContaining({
        jobId: "delivery-pr:review_run_1",
      }),
    );

    await server.close();
  });

  it("enqueues a review for merged pull_request events", async () => {
    const dependencies = createWebhookDependencies();
    const server = buildApiServer({
      reviewQueue: dependencies.reviewQueue,
      store: dependencies.store,
      webhookSecret: WEBHOOK_SECRET,
    });
    const payload = JSON.stringify(createPullRequestPayload("closed", { merged: true }));

    const response = await server.inject({
      headers: signedHeaders({
        deliveryId: "delivery-merged",
        eventName: "pull_request",
        payload,
      }),
      method: "POST",
      payload,
      url: "/webhooks/github",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ reviewRunId: "review_run_1", status: "queued" });
    expect(dependencies.store.upsertPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "MERGED",
      }),
    );
    expect(dependencies.store.createReviewRun).toHaveBeenCalledWith({
      pullRequestId: "pull_request_1",
      trigger: "pull_request.merged",
    });
    expect(dependencies.reviewQueue.add).toHaveBeenCalledWith(
      "review-pr",
      expect.objectContaining({
        deliveryId: "delivery-merged",
        trigger: "pull_request.merged",
      }),
      expect.objectContaining({
        jobId: "delivery-merged:review_run_1",
      }),
    );

    await server.close();
  });

  it("ignores closed pull_request events that were not merged", async () => {
    const dependencies = createWebhookDependencies();
    const server = buildApiServer({
      reviewQueue: dependencies.reviewQueue,
      store: dependencies.store,
      webhookSecret: WEBHOOK_SECRET,
    });
    const payload = JSON.stringify(createPullRequestPayload("closed", { merged: false }));

    const response = await server.inject({
      headers: signedHeaders({
        deliveryId: "delivery-closed",
        eventName: "pull_request",
        payload,
      }),
      method: "POST",
      payload,
      url: "/webhooks/github",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "ignored" });
    expect(dependencies.reviewQueue.add).not.toHaveBeenCalled();

    await server.close();
  });

  it("ignores duplicate webhook deliveries", async () => {
    const dependencies = createWebhookDependencies();
    const server = buildApiServer({
      reviewQueue: dependencies.reviewQueue,
      store: dependencies.store,
      webhookSecret: WEBHOOK_SECRET,
    });
    const payload = JSON.stringify(createPullRequestPayload("opened"));
    const headers = signedHeaders({
      deliveryId: "delivery-duplicate",
      eventName: "pull_request",
      payload,
    });

    await server.inject({
      headers,
      method: "POST",
      payload,
      url: "/webhooks/github",
    });
    const response = await server.inject({
      headers,
      method: "POST",
      payload,
      url: "/webhooks/github",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "duplicate" });
    expect(dependencies.reviewQueue.add).toHaveBeenCalledTimes(1);

    await server.close();
  });

  it("enqueues a manual review from a pull request comment command", async () => {
    const dependencies = createWebhookDependencies();
    const server = buildApiServer({
      reviewQueue: dependencies.reviewQueue,
      store: dependencies.store,
      webhookSecret: WEBHOOK_SECRET,
    });
    const payload = JSON.stringify(createIssueCommentPayload("/diffguard review"));

    const response = await server.inject({
      headers: signedHeaders({
        deliveryId: "delivery-command",
        eventName: "issue_comment",
        payload,
      }),
      method: "POST",
      payload,
      url: "/webhooks/github",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ reviewRunId: "review_run_1", status: "queued" });
    expect(dependencies.store.createReviewRun).toHaveBeenCalledWith({
      pullRequestId: "pull_request_1",
      trigger: "issue_comment.diffguard_review",
    });
    expect(dependencies.reviewQueue.add).toHaveBeenCalledWith(
      "review-pr",
      expect.objectContaining({
        deliveryId: "delivery-command",
        pullNumber: 42,
        reviewRunId: "review_run_1",
        trigger: "issue_comment.diffguard_review",
      }),
      expect.objectContaining({
        jobId: "delivery-command:review_run_1",
      }),
    );

    await server.close();
  });
});

function signedHeaders(input: {
  deliveryId: string;
  eventName: string;
  payload: string;
}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-github-delivery": input.deliveryId,
    "x-github-event": input.eventName,
    "x-hub-signature-256": signPayload(input.payload),
  };
}

function signPayload(payload: string): string {
  return `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")}`;
}

function dashboardAuthHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${DASHBOARD_API_KEY}`,
  };
}

function createWebhookDependencies() {
  const deliveryIds = new Set<string>();

  return {
    reviewQueue: {
      add: vi.fn(async () => ({ id: "job_1" })),
    },
    store: {
      createReviewRun: vi.fn(async () => ({ reviewRunId: "review_run_1" })),
      recordDelivery: vi.fn(async ({ deliveryId }: { deliveryId: string }) => {
        if (deliveryIds.has(deliveryId)) {
          return { duplicate: true };
        }

        deliveryIds.add(deliveryId);
        return { duplicate: false };
      }),
      upsertPullRequest: vi.fn(async () => ({ pullRequestId: "pull_request_1" })),
      upsertRepositoryInstallation: vi.fn(async () => ({ repositoryId: "repository_1" })),
    },
  };
}

const dashboardReviewRun = {
  candidatesCount: 4,
  confidenceThreshold: 0.82,
  costUsd: 0.42,
  createdAt: "2026-06-20T10:00:00.000Z",
  findings: [
    {
      confidence: 0.91,
      file: "apps/api/src/payments.ts",
      id: "finding_live",
      line: 37,
      severity: "high" as const,
      status: "posted" as const,
      summary: "The changed handler skips the tenant ownership check.",
      title: "Payment lookup bypasses tenant scope",
    },
  ],
  findingsCount: 1,
  githubCommentStatus: "posted" as const,
  id: "rvw_live",
  latencySeconds: 31,
  modelCalls: [
    {
      costUsd: 0.18,
      id: "call_live",
      inputTokens: 1200,
      latencyMs: 6400,
      model: "gpt-4.1-mini",
      outputTokens: 180,
      purpose: "review:logic-bugs",
    },
  ],
  prNumber: 12,
  repo: "acme/payments",
  status: "completed" as const,
  title: "Fix payment lookup",
  validatorDecisions: [
    {
      confidence: 0.91,
      decision: "accepted" as const,
      finding: "Payment lookup bypasses tenant scope",
      id: "decision_live",
      reason: "Finding is high confidence and maps to the changed code.",
    },
  ],
};

const dashboardRepository = {
  confidenceThreshold: 0.82,
  enabled: true,
  id: "repo_live",
  installation: "12345",
  lastReviewedAt: "2026-06-20T10:00:00.000Z",
  maxFindingsPerPr: 5,
  repo: "acme/payments",
  rulesPath: ".diffguard-rules.md",
};

const dashboardEval = {
  cases: 32,
  costUsd: 1.24,
  createdAt: "2026-06-20T09:00:00.000Z",
  falseNegatives: 3,
  falsePositives: 1,
  id: "eval_live",
  name: "logic-bugs-v1",
  precision: 0.94,
  recall: 0.81,
};

const dashboardOverview = {
  metrics: {
    averageLatencySeconds: 31,
    estimatedResolutionRate: 0.75,
    falsePositiveFindings: 1,
    findingsPosted: 8,
    resolvedFindings: 6,
    totalCostUsd: 3.5,
    totalPrsReviewed: 12,
    unknownFindings: 1,
    unresolvedFindings: 1,
    validatorRejectionRate: 0.2,
  },
  reviewTrend: [
    {
      cost: 0.42,
      day: "Jun 20",
      findings: 1,
      latency: 31,
      prs: 1,
      rejected: 0,
    },
  ],
};

function createDashboardStore(): DashboardStore {
  return {
    getOverview: vi.fn(async () => dashboardOverview),
    getReviewRun: vi.fn(async (id: string) => (id === dashboardReviewRun.id ? dashboardReviewRun : null)),
    listEvalSummaries: vi.fn(async () => [dashboardEval]),
    listFindings: vi.fn(async () => dashboardReviewRun.findings),
    listRepositories: vi.fn(async () => [dashboardRepository]),
    listReviewRuns: vi.fn(async () => [dashboardReviewRun]),
  };
}

function createPullRequestPayload(
  action: "closed" | "opened" | "reopened" | "synchronize",
  overrides: { merged?: boolean } = {},
) {
  return {
    action,
    installation: {
      id: 98765,
    },
    pull_request: {
      base: {
        sha: "base-sha",
      },
      head: {
        sha: "head-sha",
      },
      merged: overrides.merged ?? false,
      number: 42,
      state: action === "closed" ? "closed" : "open",
      title: "Fix checkout",
      user: {
        login: "octocat",
      },
    },
    repository: {
      default_branch: "main",
      name: "widgets",
      owner: {
        login: "acme",
      },
    },
  };
}

function createIssueCommentPayload(body: string) {
  return {
    action: "created",
    comment: {
      body,
    },
    installation: {
      id: 98765,
    },
    issue: {
      number: 42,
      pull_request: {
        url: "https://api.github.com/repos/acme/widgets/pulls/42",
      },
      state: "open",
      title: "Fix checkout",
      user: {
        login: "octocat",
      },
    },
    repository: {
      default_branch: "main",
      name: "widgets",
      owner: {
        login: "acme",
      },
    },
  };
}
