import { describe, expect, it } from "vitest";

import {
  EvalCaseSchema,
  formatEvalReport,
  runEvalSuite,
  starterTypeScriptEvalCases,
  type EvalCase,
  type EvalReviewer,
} from "./index.js";

describe("starterTypeScriptEvalCases", () => {
  it("includes validated TypeScript bug cases and a false-positive trap", () => {
    expect(starterTypeScriptEvalCases).toHaveLength(11);

    const parsed = starterTypeScriptEvalCases.map((evalCase) => EvalCaseSchema.parse(evalCase));

    expect(parsed.map((evalCase) => evalCase.id)).toEqual([
      "ts-missing-authorization-check",
      "ts-missing-null-check",
      "ts-sql-injection-risk",
      "ts-broken-pagination",
      "ts-unsafe-database-migration",
      "ts-incorrect-money-calculation",
      "ts-missing-await",
      "ts-race-condition",
      "ts-insecure-logging",
      "ts-missing-test-for-changed-behavior",
      "ts-false-positive-style-only-trap",
    ]);
    expect(parsed.every((evalCase) => evalCase.language === "typescript")).toBe(true);
    expect(
      parsed.some(
        (evalCase) => evalCase.category === "logic" && evalCase.expectedFindings.length > 0,
      ),
    ).toBe(true);
    expect(
      parsed.some(
        (evalCase) => evalCase.category === "security" && evalCase.expectedFindings.length > 0,
      ),
    ).toBe(true);
    expect(parsed.some((evalCase) => evalCase.category === "testing")).toBe(true);

    const falsePositiveTrap = parsed.find(
      (evalCase) => evalCase.id === "ts-false-positive-style-only-trap",
    );
    expect(falsePositiveTrap).toMatchObject({
      category: "logic",
      expectedFindings: [],
      shouldNotMention: ["rename", "formatting", "style-only"],
    });
  });
});

describe("runEvalSuite", () => {
  it("calculates precision, recall, false positives, false negatives, and aggregate run metrics", async () => {
    const cases = [
      createEvalCase({
        expectedTitleKeywords: ["admin", "authorization"],
        id: "case-pass",
        shouldNotMention: ["rename variable"],
      }),
      createEvalCase({
        expectedTitleKeywords: ["null", "profile"],
        id: "case-miss",
      }),
    ];
    const reviewer: EvalReviewer = async (evalCase) => {
      if (evalCase.id === "case-pass") {
        return {
          costUsd: 0.012,
          findings: [
            {
              category: "authorization",
              confidence: 0.95,
              evidence: "The route now reads billing data before requireAdmin() runs.",
              filePath: "src/admin.ts",
              line: 12,
              relatedRuleIds: [],
              severity: "high",
              side: "RIGHT",
              suggestedFix: "Call requireAdmin() before reading billing data.",
              summary: "The admin route reads billing data before authorization.",
              title: "Admin authorization check is missing",
              whyItMatters: "Non-admin users could read private billing data.",
            },
            {
              category: "logic",
              confidence: 0.88,
              evidence: "This only comments on a variable name and does not prove a bug.",
              filePath: "src/admin.ts",
              line: 20,
              relatedRuleIds: [],
              severity: "low",
              side: "RIGHT",
              suggestedFix: "Rename the variable to make it easier to read.",
              summary: "Rename variable for readability in the changed function.",
              title: "Rename variable for readability",
              whyItMatters: "The current name is subjective and not a correctness issue.",
            },
          ],
          latencyMs: 125,
          modelVersion: "gpt-test",
          promptVersion: "review-v9",
          rejectedFindings: [{ reason: "validator_rejected", title: "Speculative issue" }],
        };
      }

      return {
        costUsd: 0.018,
        findings: [],
        latencyMs: 75,
        modelVersion: "gpt-test",
        promptVersion: "review-v9",
        rejectedFindings: [],
      };
    };

    const report = await runEvalSuite({
      cases,
      modelVersion: "gpt-test",
      promptVersion: "review-v9",
      reviewer,
    });

    expect(report.summary).toMatchObject({
      caseCount: 2,
      costUsd: 0.03,
      falseNegativeCount: 1,
      falsePositiveCount: 1,
      findingsPerPr: 1,
      latencyMs: 200,
      modelVersion: "gpt-test",
      precision: 0.5,
      promptVersion: "review-v9",
      recall: 0.5,
      validatorRejectionRate: 1 / 3,
    });
    expect(report.falsePositives).toEqual([
      expect.objectContaining({
        caseId: "case-pass",
        title: "Rename variable for readability",
      }),
    ]);
    expect(report.falseNegatives).toEqual([
      expect.objectContaining({
        caseId: "case-miss",
        title: "Expected missing null check",
      }),
    ]);
    expect(report.passed).toBe(false);
  });

  it("treats shouldNotMention matches as false positives even when there are no expected findings", async () => {
    const cases = [
      {
        ...createEvalCase({
          expectedTitleKeywords: ["authorization"],
          id: "quiet-case",
          shouldNotMention: ["formatting"],
        }),
        expectedFindings: [],
      },
    ];
    const reviewer: EvalReviewer = async () => ({
      costUsd: 0,
      findings: [
        {
          category: "logic",
          confidence: 0.9,
          evidence: "The comment complains only about formatting in the diff.",
          filePath: "src/example.ts",
          line: 4,
          relatedRuleIds: [],
          severity: "low",
          side: "RIGHT",
          suggestedFix: "Reformat this line to match local style.",
          summary: "This finding mentions formatting even though the case forbids it.",
          title: "Formatting-only suggestion",
          whyItMatters: "Formatting-only comments are noise for DiffGuard-AI.",
        },
      ],
      latencyMs: 10,
      modelVersion: "gpt-test",
      promptVersion: "review-v9",
      rejectedFindings: [],
    });

    const report = await runEvalSuite({
      cases,
      modelVersion: "gpt-test",
      promptVersion: "review-v9",
      reviewer,
    });

    expect(report.summary.precision).toBe(0);
    expect(report.summary.recall).toBe(1);
    expect(report.falsePositives).toHaveLength(1);
    expect(report.falsePositives[0]?.reason).toBe("mentioned_forbidden_text");
  });
});

describe("formatEvalReport", () => {
  it("renders markdown and json reports for CI logs", async () => {
    const report = await runEvalSuite({
      cases: [createEvalCase({ id: "case-pass", expectedTitleKeywords: ["authorization"] })],
      modelVersion: "gpt-test",
      promptVersion: "review-v9",
      reviewer: async () => ({
        costUsd: 0.001,
        findings: [
          {
            category: "authorization",
            confidence: 0.95,
            evidence: "The route now reads billing data before requireAdmin() runs.",
            filePath: "src/admin.ts",
            line: 12,
            relatedRuleIds: [],
            severity: "high",
            side: "RIGHT",
            suggestedFix: "Call requireAdmin() before reading billing data.",
            summary: "The admin route reads billing data before authorization.",
            title: "Admin authorization check is missing",
            whyItMatters: "Non-admin users could read private billing data.",
          },
        ],
        latencyMs: 25,
        modelVersion: "gpt-test",
        promptVersion: "review-v9",
        rejectedFindings: [],
      }),
    });

    expect(formatEvalReport(report, "markdown")).toContain("## DiffGuard-AI Eval Report");
    expect(formatEvalReport(report, "markdown")).toContain("Precision: 1.00");
    expect(JSON.parse(formatEvalReport(report, "json"))).toMatchObject({
      summary: {
        caseCount: 1,
        precision: 1,
        recall: 1,
      },
    });
  });
});

function createEvalCase(input: {
  expectedTitleKeywords: string[];
  id: string;
  shouldNotMention?: string[];
}): EvalCase {
  return {
    category: "authorization",
    diff: [
      "diff --git a/src/admin.ts b/src/admin.ts",
      "@@ -9,7 +9,7 @@ export async function getBilling(req: Request) {",
      "-  requireAdmin(req.user);",
      "+  const billing = await db.billing.findMany();",
      "   return billing;",
    ].join("\n"),
    expectedFindings: [
      {
        category: input.expectedTitleKeywords.includes("null") ? "logic" : "authorization",
        filePath: input.expectedTitleKeywords.includes("null") ? "src/profile.ts" : "src/admin.ts",
        line: 12,
        severity: input.expectedTitleKeywords.includes("null") ? "medium" : "high",
        title: input.expectedTitleKeywords.includes("null")
          ? "Expected missing null check"
          : "Expected missing authorization check",
        titleKeywords: input.expectedTitleKeywords,
      },
    ],
    id: input.id,
    language: "typescript",
    notes: "Synthetic eval case used by unit tests.",
    repoRules: "Only comment when confidence is high.",
    severity: input.expectedTitleKeywords.includes("null") ? "medium" : "high",
    shouldNotMention: input.shouldNotMention ?? [],
    title: "Unit test eval case",
  };
}
