import { describe, expect, it, vi } from "vitest";

import type { EvalReport } from "@diffguard/evals";

import { createPrismaEvalSummaryStore } from "./eval-summary-store.js";

describe("createPrismaEvalSummaryStore", () => {
  it("stores eval report summaries as Prisma eval run rows", async () => {
    const create = vi.fn(async () => ({}));
    const store = createPrismaEvalSummaryStore({
      evalRun: {
        create,
      },
    });
    const report = createEvalReport({ passed: false });

    await store({ report, runName: "review-v2 / gpt-5.5" });

    expect(create).toHaveBeenCalledWith({
      data: {
        caseCount: 1,
        costUsd: 0,
        falseNegativeCount: 1,
        falsePositiveCount: 0,
        findingsPerPr: 0,
        latencyMs: 0,
        modelVersion: "gpt-5.5",
        name: "review-v2 / gpt-5.5",
        passed: false,
        precision: 0,
        promptVersion: "review-v2",
        recall: 0,
        truePositiveCount: 0,
        validatorRejectionRate: 0,
      },
    });
  });
});

function createEvalReport(input: { passed: boolean }): EvalReport {
  return {
    caseResults: [],
    falseNegatives: [],
    falsePositives: [],
    passed: input.passed,
    summary: {
      caseCount: 1,
      costUsd: 0,
      falseNegativeCount: input.passed ? 0 : 1,
      falsePositiveCount: 0,
      findingsPerPr: 0,
      latencyMs: 0,
      modelVersion: "gpt-5.5",
      precision: input.passed ? 1 : 0,
      promptVersion: "review-v2",
      recall: input.passed ? 1 : 0,
      truePositiveCount: input.passed ? 1 : 0,
      validatorRejectionRate: 0,
    },
  };
}
