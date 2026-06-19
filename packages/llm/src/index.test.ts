import { describe, expect, it } from "vitest";

import {
  LlmValidationError,
  REVIEW_PROMPT_VERSION,
  REVIEW_PROMPT_TEMPLATES,
  createReviewPromptInput,
  reviewDiffWithLlm,
  type LlmProvider,
} from "./index.js";

describe("createReviewPromptInput", () => {
  it("keeps prompts versioned and includes repository rules", () => {
    const input = createReviewPromptInput({
      diff: "diff --git a/file.ts b/file.ts",
      rules: "Only comment when confidence is high.",
      context: ["src/file.ts"],
    });

    expect(REVIEW_PROMPT_VERSION).toBe("review-v1");
    expect(input.rules).toContain("confidence is high");
  });
});

describe("REVIEW_PROMPT_TEMPLATES", () => {
  it("defines versioned templates for the required review categories", () => {
    expect(Object.keys(REVIEW_PROMPT_TEMPLATES).sort()).toEqual([
      "logic-bugs",
      "regression-test-gaps",
      "security-bugs",
    ]);
    expect(REVIEW_PROMPT_TEMPLATES["logic-bugs"].version).toBe(REVIEW_PROMPT_VERSION);
    expect(REVIEW_PROMPT_TEMPLATES["security-bugs"].system).toContain("security");
    expect(REVIEW_PROMPT_TEMPLATES["regression-test-gaps"].system).toContain("tests");
  });
});

describe("reviewDiffWithLlm", () => {
  it("validates fake provider output before returning findings", async () => {
    const provider = createFakeProvider([
      {
        output: {
          findings: [
            createFinding({
              title: "Admin route returns data before auth",
              category: "authorization",
            }),
          ],
        },
      },
    ]);

    const result = await reviewDiffWithLlm({
      diff: "diff --git a/src/routes/admin.ts b/src/routes/admin.ts",
      pricing: {
        inputUsdPerMillionTokens: 2,
        outputUsdPerMillionTokens: 8,
      },
      provider,
      providerName: "fake",
      rules: "All admin routes must call requireAdmin().",
      templateId: "security-bugs",
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.category).toBe("authorization");
    expect(result.modelCalls[0]).toMatchObject({
      attempt: 1,
      model: "fake-review-model",
      promptVersion: REVIEW_PROMPT_VERSION,
      provider: "fake",
      status: "succeeded",
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 125,
      },
    });
    expect(result.modelCalls[0]?.costUsd).toBe(0.0004);
    expect(result.modelCalls[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(provider.requests[0]?.responseSchemaName).toBe("diffguard_review_findings");
  });

  it("retries when structured output fails validation", async () => {
    const provider = createFakeProvider([
      {
        output: {
          findings: [
            {
              title: "Legacy shape should be rejected",
              body: "The model used the old body field.",
              category: "logic_bug",
              confidence: 0.95,
              location: { path: "src/file.ts", startLine: 10 },
              severity: "high",
            },
          ],
        },
      },
      {
        output: {
          findings: [createFinding({ title: "Null check regression can throw" })],
        },
      },
    ]);

    const result = await reviewDiffWithLlm({
      diff: "diff --git a/src/file.ts b/src/file.ts",
      maxValidationRetries: 1,
      provider,
      rules: null,
      templateId: "logic-bugs",
    });

    expect(result.findings[0]?.title).toBe("Null check regression can throw");
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.messages.at(-1)?.content).toContain("Previous output was invalid");
    expect(result.modelCalls.map((call) => call.status)).toEqual(["invalid_output", "succeeded"]);
  });

  it("throws without exposing raw model text when invalid output retries are exhausted", async () => {
    const provider = createFakeProvider([
      {
        output: {
          findings: [{ title: "Invalid output missing required fields" }],
        },
      },
    ]);

    await expect(
      reviewDiffWithLlm({
        diff: "diff --git a/src/file.ts b/src/file.ts",
        maxValidationRetries: 0,
        provider,
        rules: null,
        templateId: "logic-bugs",
      }),
    ).rejects.toBeInstanceOf(LlmValidationError);
  });
});

type FakeProviderResponse = {
  output: unknown;
};

type CapturedProviderRequest = Parameters<LlmProvider["generateJson"]>[0];

function createFakeProvider(responses: FakeProviderResponse[]): LlmProvider & {
  requests: CapturedProviderRequest[];
} {
  const requests: CapturedProviderRequest[] = [];

  return {
    requests,
    async generateJson(request) {
      requests.push(request);
      const response = responses.shift();
      if (response === undefined) {
        throw new Error("Fake provider has no response queued.");
      }

      return {
        model: "fake-review-model",
        output: response.output,
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 25,
          totalTokens: 125,
        },
      };
    },
  };
}

function createFinding(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    title: "Changed null check can throw",
    category: "logic",
    severity: "high",
    confidence: 0.92,
    filePath: "src/file.ts",
    line: 12,
    side: "RIGHT",
    summary: "The new condition dereferences value before checking whether it is null.",
    evidence: "The diff changes `if (value && value.id)` to `if (value.id && value)`.",
    suggestedFix: "Check value before reading value.id.",
    whyItMatters: "Requests with null values will now throw instead of returning safely.",
    relatedRuleIds: [],
    ...overrides,
  };
}
