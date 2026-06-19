import { describe, expect, it } from "vitest";

import { ReviewFindingSchema } from "./review-finding.js";

describe("ReviewFindingSchema", () => {
  it("accepts a high-confidence security finding with the model output shape", () => {
    const parsed = ReviewFindingSchema.parse({
      title: "Admin route misses authorization",
      category: "authorization",
      severity: "high",
      confidence: 0.93,
      filePath: "apps/api/src/routes/admin.ts",
      line: 42,
      side: "RIGHT",
      summary: "The changed route returns customer data before requireAdmin() runs.",
      evidence: "The new handler loads customer records before checking admin privileges.",
      suggestedFix: "Call requireAdmin() before loading customer records.",
      whyItMatters: "Unauthenticated users could read private customer data.",
      relatedRuleIds: ["repo-rule-admin-auth"],
    });

    expect(parsed.confidence).toBe(0.93);
    expect(parsed.filePath).toBe("apps/api/src/routes/admin.ts");
    expect(parsed.side).toBe("RIGHT");
  });

  it("rejects low-confidence comments", () => {
    const result = ReviewFindingSchema.safeParse({
      title: "Maybe rename this",
      category: "logic",
      severity: "low",
      confidence: 0.4,
      filePath: "src/file.ts",
      line: 1,
      side: "RIGHT",
      summary: "This might be easier to read with a different name.",
      evidence: "The variable name is short.",
      suggestedFix: "Rename the variable.",
      whyItMatters: "This is not a concrete bug.",
      relatedRuleIds: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects legacy category names", () => {
    const result = ReviewFindingSchema.safeParse({
      title: "Admin route misses authorization",
      category: "missing_authorization",
      severity: "high",
      confidence: 0.93,
      filePath: "apps/api/src/routes/admin.ts",
      line: 42,
      side: "RIGHT",
      summary: "The changed route returns customer data before requireAdmin() runs.",
      evidence: "The new handler loads customer records before checking admin privileges.",
      suggestedFix: "Call requireAdmin() before loading customer records.",
      whyItMatters: "Unauthenticated users could read private customer data.",
      relatedRuleIds: ["repo-rule-admin-auth"],
    });

    expect(result.success).toBe(false);
  });
});
