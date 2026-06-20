import { describe, expect, it, vi } from "vitest";

import type { PullRequestFile } from "@diffguard/github";

import {
  calculateResolutionMetrics,
  trackFindingResolutions,
  type ResolutionValidator,
  type StoredPostedFinding,
} from "./resolution-tracker.js";

const latestFile: PullRequestFile = {
  additions: 4,
  changes: 6,
  deletions: 2,
  filename: "src/admin.ts",
  patch: "@@ -10,6 +10,7 @@\n+requireAdmin(user);\n return customer;",
  sha: "latest-file-sha",
  status: "modified",
};

describe("resolution tracking", () => {
  it("classifies a posted finding as resolved when the validator finds the bug was fixed", async () => {
    const validator = createValidator("resolved");

    const result = await trackFindingResolutions({
      findings: [createPostedFinding()],
      latestDiff: "diff --git a/src/admin.ts b/src/admin.ts\n+requireAdmin(user);",
      latestFiles: [latestFile],
      validator,
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        findingId: "finding_1",
        reason: "The latest code now calls requireAdmin before returning customer data.",
        status: "resolved",
      }),
    ]);
    expect(validator).toHaveBeenCalledWith(
      expect.objectContaining({
        finding: expect.objectContaining({ id: "finding_1" }),
        latestCodeContext: [
          "File: src/admin.ts\nPatch:\n@@ -10,6 +10,7 @@\n+requireAdmin(user);\n return customer;",
        ],
        latestDiff: "diff --git a/src/admin.ts b/src/admin.ts\n+requireAdmin(user);",
      }),
    );
    expect(result.metrics).toEqual({
      estimatedResolutionRate: 1,
      falsePositiveFindings: 0,
      postedFindings: 1,
      resolvedFindings: 1,
      unknownFindings: 0,
      unresolvedFindings: 0,
    });
  });

  it("classifies a posted finding as unresolved when the validator still sees the bug", async () => {
    const result = await trackFindingResolutions({
      findings: [createPostedFinding()],
      latestDiff: "diff --git a/src/admin.ts b/src/admin.ts\n+return customer;",
      latestFiles: [latestFile],
      validator: createValidator("unresolved"),
    });

    expect(result.results[0]).toEqual(
      expect.objectContaining({
        findingId: "finding_1",
        status: "unresolved",
      }),
    );
    expect(result.metrics.unresolvedFindings).toBe(1);
    expect(result.metrics.estimatedResolutionRate).toBe(0);
  });

  it("classifies a likely false positive when the validator finds the original claim was unsupported", async () => {
    const result = await trackFindingResolutions({
      findings: [createPostedFinding()],
      latestDiff: "diff --git a/src/admin.ts b/src/admin.ts\n unchanged context",
      latestFiles: [latestFile],
      validator: createValidator("false_positive"),
    });

    expect(result.results[0]).toEqual(
      expect.objectContaining({
        findingId: "finding_1",
        status: "false_positive",
      }),
    );
    expect(result.metrics.falsePositiveFindings).toBe(1);
  });

  it("accepts validator adapter telemetry while validating the required resolution fields", async () => {
    const result = await trackFindingResolutions({
      findings: [createPostedFinding()],
      latestDiff: "diff --git a/src/admin.ts b/src/admin.ts\n+requireAdmin(user);",
      latestFiles: [latestFile],
      validator: async () => ({
        confidence: 0.93,
        modelCalls: [],
        promptVersion: "resolution-validator-v1",
        reason: "The latest code now calls requireAdmin before returning customer data.",
        status: "resolved",
      }),
    });

    expect(result.results[0]).toEqual(
      expect.objectContaining({
        findingId: "finding_1",
        status: "resolved",
      }),
    );
  });

  it("marks a finding unknown when latest evidence is insufficient", async () => {
    const validator = createValidator("resolved");

    const result = await trackFindingResolutions({
      findings: [createPostedFinding()],
      latestDiff: "",
      latestFiles: [],
      validator,
    });

    expect(result.results[0]).toEqual({
      confidence: 0,
      findingId: "finding_1",
      reason: "Latest diff/code evidence did not include the original finding location.",
      status: "unknown",
    });
    expect(validator).not.toHaveBeenCalled();
    expect(result.metrics.unknownFindings).toBe(1);
  });
});

function createValidator(status: ReturnType<typeof createResolutionResult>["status"]) {
  return vi.fn<ResolutionValidator>(async () => createResolutionResult(status));
}

function createResolutionResult(status: "resolved" | "unresolved" | "false_positive" | "unknown") {
  return {
    confidence: status === "unknown" ? 0.42 : 0.91,
    reason:
      status === "resolved"
        ? "The latest code now calls requireAdmin before returning customer data."
        : "The validator produced a structured resolution decision for this finding.",
    status,
  };
}

function createPostedFinding(overrides: Partial<StoredPostedFinding> = {}): StoredPostedFinding {
  return {
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
    ...overrides,
  };
}

describe("calculateResolutionMetrics", () => {
  it("calculates approximate resolution rate from resolved over posted findings", () => {
    expect(
      calculateResolutionMetrics([
        createResolutionMetricResult("resolved"),
        createResolutionMetricResult("unresolved"),
        createResolutionMetricResult("false_positive"),
        createResolutionMetricResult("unknown"),
      ]),
    ).toEqual({
      estimatedResolutionRate: 0.25,
      falsePositiveFindings: 1,
      postedFindings: 4,
      resolvedFindings: 1,
      unknownFindings: 1,
      unresolvedFindings: 1,
    });
  });
});

function createResolutionMetricResult(
  status: "resolved" | "unresolved" | "false_positive" | "unknown",
) {
  return {
    confidence: 0.9,
    findingId: `finding_${status}`,
    reason: "Structured validator result.",
    status,
  };
}
