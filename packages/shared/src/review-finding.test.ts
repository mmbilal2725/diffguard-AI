import { describe, expect, it } from "vitest";

import { ReviewFindingSchema } from "./review-finding.js";

describe("ReviewFindingSchema", () => {
  it("accepts a high-confidence security finding", () => {
    const parsed = ReviewFindingSchema.parse({
      title: "Admin route misses authorization",
      body: "The changed route returns customer data before requireAdmin() runs.",
      category: "missing_authorization",
      severity: "high",
      confidence: 0.93,
      location: {
        path: "apps/api/src/routes/admin.ts",
        startLine: 42,
        endLine: 46
      },
      suggestedFix: "Call requireAdmin() before loading customer records.",
      ruleIds: ["repo-rule-admin-auth"]
    });

    expect(parsed.confidence).toBe(0.93);
    expect(parsed.location.path).toBe("apps/api/src/routes/admin.ts");
  });

  it("rejects low-confidence comments", () => {
    const result = ReviewFindingSchema.safeParse({
      title: "Maybe rename this",
      body: "This might be easier to read with a different name.",
      category: "logic_bug",
      severity: "low",
      confidence: 0.4,
      location: {
        path: "src/file.ts",
        startLine: 1
      }
    });

    expect(result.success).toBe(false);
  });
});
