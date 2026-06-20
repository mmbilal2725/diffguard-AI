import { describe, expect, it, vi } from "vitest";

import { createPrismaResolutionStore } from "./resolution-store.js";

describe("createPrismaResolutionStore", () => {
  it("loads stored posted findings for a pull request", async () => {
    const database = createDatabaseDouble();
    database.finding.findMany.mockResolvedValueOnce([
      {
        category: "AUTHORIZATION",
        confidence: 0.94,
        evidence: "The original diff returned customer data before requireAdmin() ran.",
        filePath: "src/admin.ts",
        githubCommentId: "901",
        id: "finding_1",
        line: 12,
        severity: "HIGH",
        side: "RIGHT",
        summary: "The admin route returns customer data before checking admin access.",
        suggestedFix: "Move requireAdmin() before the customer lookup.",
        title: "Admin route misses authorization",
        whyItMatters: "Non-admin users could read private customer data.",
      },
    ]);
    const store = createPrismaResolutionStore(database);

    const findings = await store.listPostedFindings({
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });

    expect(database.finding.findMany).toHaveBeenCalledWith({
      select: expect.any(Object),
      where: {
        githubCommentId: {
          not: null,
        },
        reviewRun: {
          pullRequest: {
            number: 42,
            repository: {
              name: "widgets",
              owner: "acme",
            },
          },
        },
      },
    });
    expect(findings[0]).toEqual(
      expect.objectContaining({
        category: "authorization",
        githubCommentId: "901",
        id: "finding_1",
        severity: "high",
      }),
    );
  });

  it("updates finding statuses and review-run resolution counters", async () => {
    const database = createDatabaseDouble();
    const store = createPrismaResolutionStore(database);

    await store.saveResolutionResults({
      metrics: {
        estimatedResolutionRate: 0.5,
        falsePositiveFindings: 1,
        postedFindings: 2,
        resolvedFindings: 1,
        unknownFindings: 0,
        unresolvedFindings: 0,
      },
      results: [
        {
          confidence: 0.91,
          findingId: "finding_resolved",
          reason: "The latest code includes the missing authorization guard.",
          status: "resolved",
        },
        {
          confidence: 0.88,
          findingId: "finding_false_positive",
          reason: "The original claim is not supported by the available evidence.",
          status: "false_positive",
        },
      ],
      reviewRunId: "review_run_2",
    });

    expect(database.finding.update).toHaveBeenNthCalledWith(1, {
      data: { status: "RESOLVED" },
      where: { id: "finding_resolved" },
    });
    expect(database.finding.update).toHaveBeenNthCalledWith(2, {
      data: { status: "FALSE_POSITIVE" },
      where: { id: "finding_false_positive" },
    });
    expect(database.reviewRun.update).toHaveBeenCalledWith({
      data: {
        estimatedFalsePositives: 1,
        resolvedFindings: 1,
      },
      where: { id: "review_run_2" },
    });
  });
});

function createDatabaseDouble() {
  return {
    finding: {
      findMany: vi.fn(),
      update: vi.fn(async () => undefined),
    },
    reviewRun: {
      update: vi.fn(async () => undefined),
    },
  };
}
