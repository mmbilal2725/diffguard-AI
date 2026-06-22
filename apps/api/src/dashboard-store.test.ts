import { describe, expect, it } from "vitest";

import { createPrismaDashboardStore } from "./dashboard-store.js";

describe("createPrismaDashboardStore", () => {
  it("maps persisted eval runs into dashboard eval summaries", async () => {
    const store = createPrismaDashboardStore({
      evalRun: {
        findMany: async () => [
          {
            caseCount: 32,
            costUsd: "1.240000",
            createdAt: new Date("2026-06-21T10:00:00.000Z"),
            falseNegativeCount: 3,
            falsePositiveCount: 1,
            id: "eval_run_1",
            name: "review-v2 / gpt-5.5",
            precision: "0.9400",
            recall: "0.8100",
          },
        ],
      },
      finding: {
        findMany: async () => [],
      },
      repository: {
        findMany: async () => [],
      },
      reviewRun: {
        findMany: async () => [],
        findUnique: async () => null,
      },
    });

    await expect(store.listEvalSummaries()).resolves.toEqual([
      {
        cases: 32,
        costUsd: 1.24,
        createdAt: "2026-06-21T10:00:00.000Z",
        falseNegatives: 3,
        falsePositives: 1,
        id: "eval_run_1",
        name: "review-v2 / gpt-5.5",
        precision: 0.94,
        recall: 0.81,
      },
    ]);
  });

  it("maps persisted review run lifecycle fields and validator decisions", async () => {
    const store = createPrismaDashboardStore({
      evalRun: {
        findMany: async () => [],
      },
      finding: {
        findMany: async () => [],
      },
      repository: {
        findMany: async () => [],
      },
      reviewRun: {
        findMany: async () => [],
        findUnique: async () => ({
          createdAt: new Date("2026-06-21T11:00:00.000Z"),
          estimatedFalsePositives: 0,
          errorMessage: null,
          findings: [],
          findingsDetected: 2,
          findingsPosted: 1,
          id: "review_run_1",
          latencyMs: 1200,
          modelCalls: [],
          pullRequest: {
            number: 42,
            repository: {
              name: "widgets",
              owner: "acme",
            },
            title: "Fix checkout",
          },
          resolvedFindings: 0,
          status: "SKIPPED",
          totalCostUsd: "0.100000",
          validatorDecisions: [
            {
              confidence: "0.9300",
              decision: "accepted",
              findingTitle: "Admin route misses authorization",
              id: "decision_1",
              reason: "Validator approved this finding.",
            },
            {
              confidence: null,
              decision: "rejected",
              findingTitle: "Speculative issue",
              id: "decision_2",
              reason: "validator_rejected",
            },
          ],
          validatorRejectionRate: "0.5000",
        }),
      },
    });

    await expect(store.getReviewRun("review_run_1")).resolves.toMatchObject({
      id: "review_run_1",
      status: "skipped",
      validatorDecisions: [
        {
          confidence: 0.93,
          decision: "accepted",
          finding: "Admin route misses authorization",
          reason: "Validator approved this finding.",
        },
        {
          confidence: 0,
          decision: "rejected",
          finding: "Speculative issue",
          reason: "validator_rejected",
        },
      ],
    });
  });
});
