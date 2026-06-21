import { describe, expect, it } from "vitest";

import type {
  DiffGuardGitHubClient,
  PullRequestFile,
  PullRequestMetadata,
} from "@diffguard/github";

import {
  buildReviewContext,
  runReviewPipeline,
  type FindingValidator,
  type LlmReviewer,
  type ReviewPipelineGitHubClient,
} from "./index.js";

const pullRequest: PullRequestMetadata = {
  additions: 12,
  authorLogin: "octocat",
  baseRef: "main",
  baseSha: "base-sha",
  changedFiles: 1,
  deletions: 2,
  draft: false,
  headRef: "feature",
  headSha: "head-sha",
  htmlUrl: "https://github.com/acme/widgets/pull/42",
  id: 123,
  number: 42,
  state: "open",
  title: "Fix widget totals",
};

const changedFile: PullRequestFile = {
  additions: 12,
  changes: 14,
  deletions: 2,
  filename: "src/widgets.ts",
  patch: "@@ -10,6 +10,7 @@\n+return total;",
  sha: "file-sha",
  status: "modified",
};

describe("review pipeline", () => {
  it("builds review context from pull request metadata, changed files, and rules", () => {
    const context = buildReviewContext({
      diff: "diff --git a/src/widgets.ts b/src/widgets.ts",
      dryRun: true,
      files: [changedFile],
      owner: "acme",
      pullNumber: 42,
      pullRequest,
      repo: "widgets",
      rules: "Only comment when confidence is high.",
    });

    expect(context.ref).toEqual({ owner: "acme", repo: "widgets", number: 42 });
    expect(context.diff).toBe("diff --git a/src/widgets.ts b/src/widgets.ts");
    expect(context.pullRequest.headSha).toBe("head-sha");
    expect(context.files).toHaveLength(1);
    expect(context.rules).toEqual({
      content: "Only comment when confidence is high.",
      found: true,
      path: ".diffguard-rules.md",
    });
    expect(context.dryRun).toBe(true);
  });

  it("does not fail when .diffguard-rules.md is missing", async () => {
    const github = createGitHubClientDouble({ rules: null });

    const result = await runReviewPipeline({
      github: { client: github },
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });

    expect(result.context.rules).toEqual({
      content: null,
      found: false,
      path: ".diffguard-rules.md",
    });
    expect(result.findings).toEqual([]);
  });

  it("handles pull requests without changed files", async () => {
    const github = createGitHubClientDouble({ files: [] });

    const result = await runReviewPipeline({
      github: { client: github },
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });

    expect(result.context.files).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("dedupes findings by file path, line, category, and normalized title", async () => {
    const github = createGitHubClientDouble();
    const findingValidator = createApprovingValidator();
    const llmReviewer: LlmReviewer = async () => [
      createFinding({ title: "Missing authorization check!" }),
      createFinding({ title: " missing   authorization check " }),
    ];

    const result = await runReviewPipeline({
      findingValidator,
      github: { client: github },
      llmReviewer,
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Missing authorization check!");
    expect(result.rejectedFindings).toContainEqual({
      reason: "duplicate",
      title: " missing   authorization check ",
    });
  });

  it("filters findings below the confidence threshold", async () => {
    const github = createGitHubClientDouble();
    const findingValidator = createApprovingValidator();
    const llmReviewer: LlmReviewer = async () => [
      createFinding({ confidence: 0.69, title: "Unclear issue below threshold" }),
      createFinding({ confidence: 0.91, title: "Admin route misses authorization" }),
    ];

    const result = await runReviewPipeline({
      findingValidator,
      github: { client: github },
      llmReviewer,
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Admin route misses authorization");
    expect(result.rejectedFindings).toContainEqual({
      reason: "low_confidence",
      title: "Unclear issue below threshold",
    });
  });

  it("rejects style-only findings", async () => {
    const github = createGitHubClientDouble();
    const validatorInputs: Parameters<FindingValidator>[0][] = [];
    const findingValidator: FindingValidator = async (input) => {
      validatorInputs.push(input);

      return {
        confidence: 0.95,
        falsePositiveRisk: "low",
        reason: "The validator response is intentionally permissive for this test.",
        shouldPost: true,
        valid: true,
      };
    };
    const llmReviewer: LlmReviewer = async () => [
      createFinding({
        category: "style_only",
        confidence: 0.99,
        summary: "This comment only asks to rename a variable and does not describe a real bug.",
        title: "Rename variable for readability",
      }),
    ];

    const result = await runReviewPipeline({
      findingValidator,
      github: { client: github },
      llmReviewer,
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });

    expect(result.findings).toEqual([]);
    expect(validatorInputs).toHaveLength(1);
    expect(result.rejectedFindings).toContainEqual({
      reason: "style_only",
      title: "Rename variable for readability",
    });
  });

  it("posts a valid high-confidence finding approved by the validator", async () => {
    const github = createGitHubClientDouble();
    const validatorInputs: Parameters<FindingValidator>[0][] = [];
    const findingValidator: FindingValidator = async (input) => {
      validatorInputs.push(input);

      return {
        confidence: 0.94,
        falsePositiveRisk: "low",
        reason: "The diff evidence and repository rule both support this authorization bug.",
        shouldPost: true,
        valid: true,
      };
    };
    const llmReviewer: LlmReviewer = async () => [
      createFinding({
        category: "authorization",
        confidence: 0.96,
        title: "Admin route misses authorization",
      }),
    ];

    const result = await runReviewPipeline({
      findingValidator,
      github: { client: github },
      llmReviewer,
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.title).toBe("Admin route misses authorization");
    expect(validatorInputs).toHaveLength(1);
    expect(validatorInputs[0]?.diff).toContain(changedFile.patch);
    expect(validatorInputs[0]?.relevantCodeContext).toEqual([
      "File: src/widgets.ts\nPatch:\n@@ -10,6 +10,7 @@\n+return total;",
    ]);
    expect(validatorInputs[0]?.rules).toBe("Only comment when confidence is high.");
    expect(validatorInputs[0]?.staticCheckResults).toEqual([]);
    expect(validatorInputs[0]?.finding.title).toBe("Admin route misses authorization");
  });

  it("rejects speculative findings when the validator says not to post", async () => {
    const github = createGitHubClientDouble();
    const llmReviewer: LlmReviewer = async () => [
      createFinding({
        confidence: 0.91,
        evidence: "The diff shows a changed branch, but no failing path is proven from context.",
        title: "Possible edge case in total calculation",
      }),
    ];

    const result = await runReviewPipeline({
      findingValidator: async () => ({
        confidence: 0.86,
        falsePositiveRisk: "medium",
        reason: "The claim depends on an unproven input shape and should stay silent.",
        shouldPost: false,
        valid: false,
      }),
      github: { client: github },
      llmReviewer,
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });

    expect(result.findings).toEqual([]);
    expect(result.rejectedFindings).toContainEqual({
      reason: "validator_rejected",
      title: "Possible edge case in total calculation",
    });
  });

  it("rejects duplicate findings after each candidate has been validated", async () => {
    const github = createGitHubClientDouble();
    const validatorInputs: Parameters<FindingValidator>[0][] = [];
    const findingValidator: FindingValidator = async (input) => {
      validatorInputs.push(input);

      return {
        confidence: 0.95,
        falsePositiveRisk: "low",
        reason: "The authorization issue is supported by the diff.",
        shouldPost: true,
        valid: true,
      };
    };
    const llmReviewer: LlmReviewer = async () => [
      createFinding({ title: "Missing authorization check!" }),
      createFinding({ title: " missing   authorization check " }),
    ];

    const result = await runReviewPipeline({
      findingValidator,
      github: { client: github },
      llmReviewer,
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });

    expect(validatorInputs).toHaveLength(2);
    expect(result.findings).toHaveLength(1);
    expect(result.rejectedFindings).toContainEqual({
      reason: "duplicate",
      title: " missing   authorization check ",
    });
  });

  it("rejects low-confidence validator results", async () => {
    const github = createGitHubClientDouble();
    const llmReviewer: LlmReviewer = async () => [
      createFinding({ confidence: 0.95, title: "Admin route misses authorization" }),
    ];

    const result = await runReviewPipeline({
      findingValidator: async () => ({
        confidence: 0.69,
        falsePositiveRisk: "low",
        reason: "The evidence is plausible but not strong enough for a posted comment.",
        shouldPost: true,
        valid: true,
      }),
      github: { client: github },
      llmReviewer,
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });

    expect(result.findings).toEqual([]);
    expect(result.rejectedFindings).toContainEqual({
      reason: "validator_low_confidence",
      title: "Admin route misses authorization",
    });
  });

  it("uses an improved comment returned by the validator", async () => {
    const github = createGitHubClientDouble();
    const improvedComment =
      "Move requireAdmin() before the customer lookup so non-admin users cannot read customer records.";
    const llmReviewer: LlmReviewer = async () => [
      createFinding({ title: "Admin route misses authorization" }),
    ];

    const result = await runReviewPipeline({
      findingValidator: async () => ({
        confidence: 0.97,
        falsePositiveRisk: "low",
        improvedComment,
        reason: "The validator rewrote the comment to be more actionable.",
        shouldPost: true,
        valid: true,
      }),
      github: { client: github },
      llmReviewer,
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.improvedComment).toBe(improvedComment);
  });

  it("rejects findings that do not include concrete evidence", async () => {
    const github = createGitHubClientDouble();
    const findingValidator = createApprovingValidator();
    const llmReviewer: LlmReviewer = async () => [
      createFinding({
        evidence: undefined,
        title: "Admin route misses authorization",
      }),
    ];

    const result = await runReviewPipeline({
      findingValidator,
      github: { client: github },
      llmReviewer,
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });

    expect(result.findings).toEqual([]);
    expect(result.rejectedFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "invalid",
          title: "Admin route misses authorization",
        }),
      ]),
    );
  });

  it("returns a successful ReviewResult with validated findings and stage timings", async () => {
    const github = createGitHubClientDouble();
    const findingValidator = createApprovingValidator();
    const llmReviewer: LlmReviewer = async () => [
      createFinding({
        category: "authorization",
        confidence: 0.96,
        severity: "critical",
        summary: "The admin route returns customer data before requireAdmin() is called.",
        title: "Admin route misses authorization",
      }),
    ];

    const result = await runReviewPipeline({
      dryRun: true,
      findingValidator,
      github: { client: github },
      llmReviewer,
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });

    expect(result).toMatchObject({
      dryRun: true,
      findings: [
        {
          category: "authorization",
          confidence: 0.96,
          severity: "critical",
          title: "Admin route misses authorization",
        },
      ],
      pullRequest: {
        number: 42,
        title: "Fix widget totals",
      },
    });
    expect(result.timings.map((timing) => timing.stage)).toEqual([
      "fetch_pull_request",
      "list_changed_files",
      "fetch_pull_request_diff",
      "read_rules",
      "build_context",
      "static_checks",
      "llm_review",
      "validate_findings",
      "dedupe_findings",
      "filter_findings",
    ]);
    expect(result.timings.every((timing) => timing.durationMs >= 0)).toBe(true);
  });

  it("preserves model-call telemetry returned by the LLM reviewer", async () => {
    const github = createGitHubClientDouble();
    const findingValidator = createApprovingValidator();
    const llmReviewer: LlmReviewer = async () => ({
      findings: [
        createFinding({
          category: "logic",
          confidence: 0.96,
          title: "Changed null check can throw",
        }),
      ],
      modelCalls: [
        {
          attempt: 1,
          costUsd: 0.0004,
          latencyMs: 25,
          model: "fake-review-model",
          promptVersion: "review-v1",
          provider: "fake",
          status: "succeeded",
          templateId: "logic-bugs",
          tokenUsage: {
            inputTokens: 100,
            outputTokens: 25,
            totalTokens: 125,
          },
        },
      ],
    });

    const result = await runReviewPipeline({
      findingValidator,
      github: { client: github },
      llmReviewer,
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });

    expect(result.findings).toHaveLength(1);
    expect(result.modelCalls).toEqual([
      expect.objectContaining({
        attempt: 1,
        model: "fake-review-model",
        promptVersion: "review-v1",
        provider: "fake",
        status: "succeeded",
        templateId: "logic-bugs",
      }),
    ]);
  });
});

function createGitHubClientDouble(
  input: {
    files?: PullRequestFile[];
    rules?: string | null;
  } = {},
): ReviewPipelineGitHubClient {
  const files = input.files ?? [changedFile];
  const rules = input.rules === undefined ? "Only comment when confidence is high." : input.rules;

  return {
    fetchPullRequestDiff: async () => ({
      ok: true,
      data: `diff --git a/src/widgets.ts b/src/widgets.ts\n${changedFile.patch}`,
    }),
    getPullRequestMetadata: async () => ({ ok: true, data: pullRequest }),
    listPullRequestFiles: async () => ({ ok: true, data: files }),
    readDiffGuardRules: async () => ({ ok: true, data: rules }),
  } satisfies Pick<
    DiffGuardGitHubClient,
    "fetchPullRequestDiff" | "getPullRequestMetadata" | "listPullRequestFiles" | "readDiffGuardRules"
  >;
}

function createApprovingValidator(): FindingValidator {
  return async () => ({
    confidence: 0.95,
    falsePositiveRisk: "low",
    reason: "The finding is actionable and supported by changed-code evidence.",
    shouldPost: true,
    valid: true,
  });
}

function createFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category: "authorization",
    confidence: 0.93,
    evidence: "The changed route returns customer data before requireAdmin() runs.",
    filePath: "src/widgets.ts",
    line: 12,
    relatedRuleIds: ["repo-rule-admin-auth"],
    severity: "high",
    side: "RIGHT",
    summary: "The changed route returns customer data before requireAdmin() runs.",
    suggestedFix: "Call requireAdmin() before loading customer records.",
    whyItMatters: "Users without admin privileges could read private customer data.",
    title: "Missing authorization check",
    ...overrides,
  };
}
