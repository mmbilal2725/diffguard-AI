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

  it("tracks resolutions for previously posted findings using latest review evidence", async () => {
    const savedResolutionRuns: unknown[] = [];
    const createInstallationToken = vi.fn(async () => ({
      expiresAt: "2026-06-20T00:00:00Z",
      token: "ghs_installation_token",
    }));
    const runReviewPipeline = vi.fn(async () => ({
      context: {
        dryRun: false,
        files: [
          {
            additions: 1,
            changes: 2,
            deletions: 1,
            filename: "src/admin.ts",
            patch: "@@ -10,6 +10,7 @@\n+requireAdmin(user);\n return customer;",
            sha: "latest-file-sha",
            status: "modified",
          },
        ],
        pullRequest: {
          additions: 1,
          baseRef: "main",
          baseSha: "base-sha",
          changedFiles: 1,
          deletions: 1,
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
        additions: 1,
        baseRef: "main",
        baseSha: "base-sha",
        changedFiles: 1,
        deletions: 1,
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
    const resolutionValidator = vi.fn(async () => ({
      confidence: 0.93,
      reason: "The latest code now calls requireAdmin before returning customer data.",
      status: "resolved",
    }));
    const processor = createReviewProcessor({
      appId: "12345",
      createInstallationToken,
      privateKey: "private-key",
      resolutionStore: {
        listPostedFindings: async () => [
          {
            category: "authorization",
            confidence: 0.94,
            evidence: "The original diff returned customer data before requireAdmin() ran.",
            filePath: "src/admin.ts",
            githubCommentId: "901",
            id: "finding_1",
            line: 12,
            severity: "high",
            side: "RIGHT",
            summary: "The admin route returns customer data before checking admin access.",
            suggestedFix: "Move requireAdmin() before the customer lookup.",
            title: "Admin route misses authorization",
            whyItMatters: "Non-admin users could read private customer data.",
          },
        ],
        saveResolutionResults: async (input) => {
          savedResolutionRuns.push(input);
        },
      },
      resolutionValidator,
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
        trigger: "pull_request.synchronize",
      },
    });

    expect(resolutionValidator).toHaveBeenCalledWith(
      expect.objectContaining({
        finding: expect.objectContaining({ id: "finding_1" }),
        latestCodeContext: [
          "File: src/admin.ts\nPatch:\n@@ -10,6 +10,7 @@\n+requireAdmin(user);\n return customer;",
        ],
      }),
    );
    expect(savedResolutionRuns).toEqual([
      {
        metrics: {
          estimatedResolutionRate: 1,
          falsePositiveFindings: 0,
          postedFindings: 1,
          resolvedFindings: 1,
          unknownFindings: 0,
          unresolvedFindings: 0,
        },
        reviewRunId: "review_run_1",
        results: [
          {
            confidence: 0.93,
            findingId: "finding_1",
            reason: "The latest code now calls requireAdmin before returning customer data.",
            status: "resolved",
          },
        ],
      },
    ]);
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
