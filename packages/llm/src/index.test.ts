import { describe, expect, it } from "vitest";

import {
  LlmValidationError,
  OPENAI_API_KEY_MISSING_WARNING,
  REVIEW_PROMPT_VERSION,
  REVIEW_PROMPT_TEMPLATES,
  RESOLUTION_VALIDATOR_PROMPT_VERSION,
  createReviewPromptInput,
  parseReviewPasses,
  reviewDiffWithLlm,
  validateFindingResolutionWithLlm,
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

describe("parseReviewPasses", () => {
  it("defaults to all supported low-noise review passes", () => {
    expect(parseReviewPasses(undefined)).toEqual([
      "logic-bugs",
      "security-bugs",
      "regression-test-gaps",
    ]);
  });

  it("parses DIFFGUARD_REVIEW_PASSES and deduplicates in order", () => {
    expect(parseReviewPasses(" security-bugs,logic-bugs,security-bugs ")).toEqual([
      "security-bugs",
      "logic-bugs",
    ]);
  });

  it("rejects unsupported review pass names clearly", () => {
    expect(() => parseReviewPasses("style-only")).toThrow(
      "Unsupported review pass: style-only",
    );
  });

  it("exports a clear warning for missing OPENAI_API_KEY", () => {
    expect(OPENAI_API_KEY_MISSING_WARNING).toContain("OPENAI_API_KEY");
    expect(OPENAI_API_KEY_MISSING_WARNING).toContain("skipping LLM review");
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

describe("validateFindingResolutionWithLlm", () => {
  it("uses a versioned validator prompt and validates resolution status output", async () => {
    const provider = createFakeProvider([
      {
        output: {
          confidence: 0.93,
          reason: "The latest code now performs the required authorization check first.",
          status: "resolved",
        },
      },
    ]);

    const result = await validateFindingResolutionWithLlm({
      finding: {
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
      },
      latestCodeContext: ["File: src/admin.ts\nPatch:\n+requireAdmin(user);"],
      latestDiff: "diff --git a/src/admin.ts b/src/admin.ts\n+requireAdmin(user);",
      provider,
      providerName: "fake",
    });

    expect(result.status).toBe("resolved");
    expect(result.modelCalls[0]).toMatchObject({
      promptVersion: RESOLUTION_VALIDATOR_PROMPT_VERSION,
      provider: "fake",
      status: "succeeded",
    });
    expect(provider.requests[0]?.responseSchemaName).toBe("diffguard_resolution_status");
    expect(provider.requests[0]?.messages[0]?.content).toContain(
      "Classify whether the original DiffGuard-AI finding is now resolved",
    );
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
