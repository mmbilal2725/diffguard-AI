import { describe, expect, it } from "vitest";

import type { LlmProvider } from "@diffguard/llm";
import type { ReviewResult } from "@diffguard/reviewer";

import { createWorkerLlmReviewer } from "./review-llm.js";

describe("createWorkerLlmReviewer", () => {
  it("returns a warning and skips LLM review when OPENAI_API_KEY is missing", () => {
    const setup = createWorkerLlmReviewer({});

    expect(setup.llmReviewer).toBeUndefined();
    expect(setup.warnings).toEqual([
      "OPENAI_API_KEY is not configured; skipping LLM review safely.",
    ]);
  });

  it("runs valid mocked LLM responses through the selected review passes", async () => {
    const provider = createFakeLlmProvider([
      {
        findings: [
          createFinding({
            category: "authorization",
            title: "Admin route returns data before auth",
          }),
        ],
      },
    ]);
    const setup = createWorkerLlmReviewer({
      apiKey: "sk-test",
      createProvider: () => provider,
      reviewPasses: "security-bugs",
    });

    const result = await setup.llmReviewer?.(createReviewContext());

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.messages[0]?.content).toContain("Focus on security bugs");
    expect(result).toMatchObject({
      findings: [
        expect.objectContaining({
          title: "Admin route returns data before auth",
        }),
      ],
      modelCalls: [expect.objectContaining({ templateId: "security-bugs" })],
    });
  });

  it("creates a finding validator when a validator model is configured", async () => {
    const provider = createFakeLlmProvider([
      {
        confidence: 0.97,
        falsePositiveRisk: "low",
        improvedComment: "Call requireAdmin() before returning customer data to the caller.",
        reason: "The changed file returns customer data before the required admin check.",
        shouldPost: true,
        valid: true,
      },
    ]);
    const setup = createWorkerLlmReviewer({
      apiKey: "sk-test",
      createProvider: () => provider,
      validatorModel: "gpt-test-validator",
    });

    const result = await setup.findingValidator?.({
      changedFilePatch: "@@ -10,6 +10,7 @@\n+return customer;",
      context: createReviewContext(),
      diff: "diff --git a/src/admin.ts b/src/admin.ts\n+return customer;",
      finding: createFinding({
        category: "authorization",
        title: "Admin route returns data before auth",
      }) as never,
      relevantCodeContext: ["File: src/admin.ts\nPatch:\n+return customer;"],
      reviewerConfidence: 0.92,
      rules: "All admin routes must call requireAdmin().",
      staticCheckResults: [{ ruleId: "admin-auth-order", result: "failed" }],
    });

    expect(result).toMatchObject({
      confidence: 0.97,
      falsePositiveRisk: "low",
      shouldPost: true,
      valid: true,
    });
    expect(provider.requests[0]?.model).toBe("gpt-test-validator");
    expect(provider.requests[0]?.responseSchemaName).toBe("diffguard_finding_validation");
    expect(provider.requests[0]?.messages[1]?.content).toContain("Reviewer confidence:\n0.92");
  });

  it("rejects invalid mocked LLM responses before returning findings", async () => {
    const provider = createFakeLlmProvider([
      {
        findings: [{ title: "Invalid output missing required fields" }],
      },
      {
        findings: [{ title: "Still invalid after retry" }],
      },
    ]);
    const setup = createWorkerLlmReviewer({
      apiKey: "sk-test",
      createProvider: () => provider,
    });

    await expect(setup.llmReviewer?.(createReviewContext())).rejects.toThrow(
      "LLM structured output did not match the ReviewFinding schema.",
    );
  });
});

type FakeLlmOutput = unknown;

type CapturedLlmRequest = Parameters<LlmProvider["generateJson"]>[0];

function createFakeLlmProvider(outputs: FakeLlmOutput[]): LlmProvider & {
  requests: CapturedLlmRequest[];
} {
  const requests: CapturedLlmRequest[] = [];

  return {
    requests,
    async generateJson(request) {
      requests.push(request);
      const output = outputs.shift();
      if (output === undefined) {
        throw new Error("Fake LLM provider has no queued output.");
      }

      return {
        model: request.model,
        output,
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 25,
          totalTokens: 125,
        },
      };
    },
  };
}

function createReviewContext(): ReviewResult["context"] {
  return {
    diff: "diff --git a/src/admin.ts b/src/admin.ts\n@@ -10,6 +10,7 @@\n+return customer;\n requireAdmin();",
    dryRun: true,
    files: [
      {
        additions: 1,
        changes: 2,
        deletions: 0,
        filename: "src/admin.ts",
        patch: "@@ -10,6 +10,7 @@\n+return customer;\n requireAdmin();",
        sha: "admin-sha",
        status: "modified",
      },
    ],
    pullRequest: {
      additions: 1,
      authorLogin: "octocat",
      baseRef: "main",
      baseSha: "base-sha",
      changedFiles: 1,
      deletions: 0,
      draft: false,
      headRef: "feature",
      headSha: "head-sha",
      htmlUrl: "https://github.com/acme/widgets/pull/42",
      id: 123,
      number: 42,
      state: "open",
      title: "Fix checkout",
    },
    ref: {
      number: 42,
      owner: "acme",
      repo: "widgets",
    },
    rules: {
      content: "All admin routes must call requireAdmin().",
      found: true,
      path: ".diffguard-rules.md",
    },
  };
}

function createFinding(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    title: "Changed null check can throw",
    category: "logic",
    severity: "high",
    confidence: 0.92,
    filePath: "src/admin.ts",
    line: 12,
    side: "RIGHT",
    summary: "The admin route returns customer data before checking authorization.",
    evidence: "The diff returns customer data before requireAdmin() runs.",
    suggestedFix: "Move requireAdmin() before returning customer data.",
    whyItMatters: "Non-admin users could read private customer data.",
    relatedRuleIds: [],
    ...overrides,
  };
}
