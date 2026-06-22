import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatCurrency,
  formatDuration,
  getDashboardOverview,
  getDashboardMetrics,
  getEvalRuns,
  getFindings,
  getRepositories,
  getReviewRunById,
  getReviewRuns,
  getReviewTrend
} from "./dashboard-data";

describe("dashboard data", () => {
  beforeEach(() => {
    vi.stubEnv("DIFFGUARD_API_BASE_URL", "http://api.local");
    vi.stubEnv("DIFFGUARD_DASHBOARD_API_KEY", "test-dashboard-api-key");
    vi.stubEnv("DIFFGUARD_DEMO_MODE", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("loads overview metrics and trend data from the API", async () => {
    const fetchMock = stubDashboardFetch();

    await expect(getDashboardOverview()).resolves.toEqual(apiOverview);
    await expect(getDashboardMetrics()).resolves.toEqual(apiOverview.metrics);
    await expect(getReviewTrend()).resolves.toEqual(apiOverview.reviewTrend);

    expect(fetchMock).toHaveBeenCalledWith("http://api.local/dashboard/overview", {
      cache: "no-store",
      headers: {
        authorization: "Bearer test-dashboard-api-key"
      }
    });
  });

  it("loads dashboard collections from API endpoints", async () => {
    const fetchMock = stubDashboardFetch();

    await expect(getReviewRuns()).resolves.toEqual([apiReviewRun]);
    await expect(getReviewRunById("rvw_api")).resolves.toEqual(apiReviewRun);
    await expect(getRepositories()).resolves.toEqual([apiRepository]);
    await expect(getFindings()).resolves.toEqual(apiReviewRun.findings);
    await expect(getEvalRuns()).resolves.toEqual([apiEval]);

    expect(fetchMock).toHaveBeenCalledWith("http://api.local/dashboard/review-runs", {
      cache: "no-store",
      headers: {
        authorization: "Bearer test-dashboard-api-key"
      }
    });
    expect(fetchMock).toHaveBeenCalledWith("http://api.local/dashboard/review-runs/rvw_api", {
      cache: "no-store",
      headers: {
        authorization: "Bearer test-dashboard-api-key"
      }
    });
    expect(fetchMock).toHaveBeenCalledWith("http://api.local/dashboard/repositories", {
      cache: "no-store",
      headers: {
        authorization: "Bearer test-dashboard-api-key"
      }
    });
    expect(fetchMock).toHaveBeenCalledWith("http://api.local/dashboard/findings", {
      cache: "no-store",
      headers: {
        authorization: "Bearer test-dashboard-api-key"
      }
    });
    expect(fetchMock).toHaveBeenCalledWith("http://api.local/dashboard/evals", {
      cache: "no-store",
      headers: {
        authorization: "Bearer test-dashboard-api-key"
      }
    });
  });

  it("requires a dashboard API key outside local demo mode", async () => {
    vi.stubEnv("DIFFGUARD_DASHBOARD_API_KEY", "");

    await expect(getReviewRuns()).rejects.toThrow("Dashboard API key is required");
  });

  it("uses mock fallback only when local demo mode is enabled", async () => {
    vi.stubEnv("DIFFGUARD_DEMO_MODE", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("API offline");
      })
    );

    const runs = await getReviewRuns();

    expect(runs.map((run) => run.id)).toEqual(["rvw_1042", "rvw_1041", "rvw_1040", "rvw_1039"]);
  });

  it("does not enable mock fallback from public client environment variables", async () => {
    vi.stubEnv("DIFFGUARD_DEMO_MODE", undefined);
    vi.stubEnv("NEXT_PUBLIC_DIFFGUARD_DEMO_MODE", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("API offline");
      })
    );

    await expect(getReviewRuns()).rejects.toThrow("Failed to load /dashboard/review-runs");
  });

  it("surfaces API failures outside local demo mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("API offline");
      })
    );

    await expect(getReviewRuns()).rejects.toThrow("Failed to load /dashboard/review-runs");
  });

  it("formats cost and latency for dashboard display", () => {
    expect(formatCurrency(12.5)).toBe("$12.50");
    expect(formatCurrency(0.186)).toBe("$0.19");
    expect(formatDuration(48)).toBe("48s");
    expect(formatDuration(125)).toBe("2m 5s");
  });
});

const apiFinding = {
  confidence: 0.93,
  file: "apps/api/src/payments.ts",
  id: "finding_api",
  line: 44,
  severity: "high" as const,
  status: "posted" as const,
  summary: "The new lookup does not filter by tenant id.",
  title: "Payment lookup misses tenant scope"
};

const apiReviewRun = {
  candidatesCount: 3,
  confidenceThreshold: 0.82,
  costUsd: 0.31,
  createdAt: "2026-06-20T12:00:00.000Z",
  findings: [apiFinding],
  findingsCount: 1,
  githubCommentStatus: "posted" as const,
  id: "rvw_api",
  latencySeconds: 27,
  modelCalls: [
    {
      costUsd: 0.16,
      id: "call_api",
      inputTokens: 1000,
      latencyMs: 5400,
      model: "gpt-4.1-mini",
      outputTokens: 140,
      purpose: "review:security-bugs"
    }
  ],
  prNumber: 99,
  repo: "acme/payments",
  status: "completed" as const,
  title: "Secure payment lookup",
  validatorDecisions: [
    {
      confidence: 0.93,
      decision: "accepted" as const,
      finding: "Payment lookup misses tenant scope",
      id: "decision_api",
      reason: "Finding maps to changed code and has concrete impact."
    }
  ]
};

const apiRepository = {
  confidenceThreshold: 0.82,
  enabled: true,
  id: "repo_api",
  installation: "12345",
  lastReviewedAt: "2026-06-20T12:00:00.000Z",
  maxFindingsPerPr: 5,
  repo: "acme/payments",
  rulesPath: ".diffguard-rules.md"
};

const apiEval = {
  cases: 16,
  costUsd: 0.84,
  createdAt: "2026-06-20T11:00:00.000Z",
  falseNegatives: 2,
  falsePositives: 1,
  id: "eval_api",
  name: "security-bugs-v1",
  precision: 0.9,
  recall: 0.78
};

const apiOverview = {
  metrics: {
    averageLatencySeconds: 27,
    estimatedResolutionRate: 0.75,
    falsePositiveFindings: 1,
    findingsPosted: 6,
    resolvedFindings: 3,
    totalCostUsd: 2.1,
    totalPrsReviewed: 4,
    unknownFindings: 1,
    unresolvedFindings: 1,
    validatorRejectionRate: 0.25
  },
  reviewTrend: [
    {
      cost: 0.31,
      day: "Jun 20",
      findings: 1,
      latency: 27,
      prs: 1,
      rejected: 1
    }
  ]
};

function stubDashboardFetch() {
  const payloads = new Map<string, unknown>([
    ["/dashboard/overview", apiOverview],
    ["/dashboard/review-runs", { reviewRuns: [apiReviewRun] }],
    ["/dashboard/review-runs/rvw_api", { reviewRun: apiReviewRun }],
    ["/dashboard/repositories", { repositories: [apiRepository] }],
    ["/dashboard/findings", { findings: [apiFinding] }],
    ["/dashboard/evals", { evals: [apiEval] }],
  ]);

  const fetchMock = vi.fn(async (url: string) => {
    const pathname = new URL(url).pathname;
    const payload = payloads.get(pathname);
    if (payload === undefined) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    }

    return new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json" },
      status: 200
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
