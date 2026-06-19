import { describe, expect, it } from "vitest";

import {
  formatCurrency,
  formatDuration,
  getDashboardMetrics,
  getReviewRunById,
  getReviewRuns
} from "./dashboard-data";

describe("dashboard data", () => {
  it("calculates overview metrics from review runs and eval results", () => {
    const metrics = getDashboardMetrics();

    expect(metrics.totalPrsReviewed).toBe(186);
    expect(metrics.findingsPosted).toBe(341);
    expect(metrics.validatorRejectionRate).toBeCloseTo(0.34, 2);
    expect(metrics.estimatedResolutionRate).toBeCloseTo(0.72, 2);
    expect(metrics.totalCostUsd).toBeCloseTo(128.44, 2);
    expect(metrics.averageLatencySeconds).toBe(48);
  });

  it("sorts review runs with newest runs first", () => {
    const runs = getReviewRuns();

    expect(runs.map((run) => run.id)).toEqual(["rvw_1042", "rvw_1041", "rvw_1040", "rvw_1039"]);
  });

  it("returns review run details by id", () => {
    const run = getReviewRunById("rvw_1042");

    expect(run?.repo).toBe("acme/payments");
    expect(run?.findings).toHaveLength(3);
    expect(run?.validatorDecisions[0]?.decision).toBe("accepted");
    expect(run?.modelCalls[0]?.model).toBe("gpt-4.1");
  });

  it("formats cost and latency for dashboard display", () => {
    expect(formatCurrency(12.5)).toBe("$12.50");
    expect(formatCurrency(0.186)).toBe("$0.19");
    expect(formatDuration(48)).toBe("48s");
    expect(formatDuration(125)).toBe("2m 5s");
  });
});
