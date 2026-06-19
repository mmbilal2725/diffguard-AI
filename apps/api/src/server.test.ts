import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { buildApiServer } from "./server.js";

const WEBHOOK_SECRET = "test-webhook-secret";

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

function createPullRequestPayload(action: "opened" | "reopened" | "synchronize") {
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
      number: 42,
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
