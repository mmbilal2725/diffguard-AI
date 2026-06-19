import { describe, expect, it, vi } from "vitest";

import { createReviewProcessor } from "./review-processor.js";

describe("createReviewProcessor", () => {
  it("creates an installation token and runs the review pipeline for a queued PR", async () => {
    const createInstallationToken = vi.fn(async () => ({
      expiresAt: "2026-06-20T00:00:00Z",
      token: "ghs_installation_token",
    }));
    const runReviewPipeline = vi.fn(async () => ({
      context: {
        dryRun: false,
        files: [],
        pullRequest: {
          additions: 0,
          baseRef: "main",
          baseSha: "base-sha",
          changedFiles: 0,
          deletions: 0,
          draft: false,
          headRef: "feature",
          headSha: "head-sha",
          htmlUrl: "https://github.com/acme/widgets/pull/42",
          id: 123,
          number: 42,
          state: "open",
          title: "Fix checkout",
        },
        ref: {
          number: 42,
          owner: "acme",
          repo: "widgets",
        },
        rules: {
          content: null,
          found: false,
          path: ".diffguard-rules.md" as const,
        },
      },
      dryRun: false,
      findings: [],
      pullRequest: {
        additions: 0,
        baseRef: "main",
        baseSha: "base-sha",
        changedFiles: 0,
        deletions: 0,
        draft: false,
        headRef: "feature",
        headSha: "head-sha",
        htmlUrl: "https://github.com/acme/widgets/pull/42",
        id: 123,
        number: 42,
        state: "open",
        title: "Fix checkout",
      },
      rejectedFindings: [],
      timings: [],
    }));
    const processor = createReviewProcessor({
      appId: "12345",
      createInstallationToken,
      privateKey: "private-key",
      runReviewPipeline,
    });

    await processor({
      data: {
        deliveryId: "delivery-1",
        headSha: "head-sha",
        installationId: "98765",
        owner: "acme",
        pullNumber: 42,
        repo: "widgets",
        reviewRunId: "review_run_1",
        trigger: "pull_request.opened",
      },
      log: vi.fn(),
    });

    expect(createInstallationToken).toHaveBeenCalledWith({
      appId: "12345",
      installationId: "98765",
      privateKey: "private-key",
    });
    expect(runReviewPipeline).toHaveBeenCalledWith({
      dryRun: false,
      github: { authToken: "ghs_installation_token" },
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });
    expect(JSON.stringify(runReviewPipeline.mock.calls)).toContain("ghs_installation_token");
    expect(JSON.stringify(createInstallationToken.mock.calls)).not.toContain(
      "ghs_installation_token",
    );
  });

  it("fails before processing when GitHub App credentials are missing", async () => {
    const createInstallationToken = vi.fn();
    const runReviewPipeline = vi.fn();
    const processor = createReviewProcessor({
      appId: undefined,
      createInstallationToken,
      privateKey: undefined,
      runReviewPipeline,
    });

    await expect(
      processor({
        data: {
          deliveryId: "delivery-1",
          installationId: "98765",
          owner: "acme",
          pullNumber: 42,
          repo: "widgets",
          reviewRunId: "review_run_1",
          trigger: "issue_comment.diffguard_review",
        },
      }),
    ).rejects.toThrow("GitHub App credentials are required to process review jobs.");
    expect(createInstallationToken).not.toHaveBeenCalled();
    expect(runReviewPipeline).not.toHaveBeenCalled();
  });
});
