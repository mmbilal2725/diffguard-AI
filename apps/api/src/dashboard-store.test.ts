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
});
