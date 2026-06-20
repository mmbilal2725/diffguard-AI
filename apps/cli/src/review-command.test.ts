import { describe, expect, it } from "vitest";

import type {
  CreatePullRequestReviewInput,
  DiffGuardGitHubClient,
  PostPullRequestCommentInput,
  PullRequestMetadata,
} from "@diffguard/github";
import type { ReviewResult } from "@diffguard/reviewer";
import type { LlmProvider } from "@diffguard/llm";

import {
  buildMarkdownSummary,
  parseReviewCommandOptions,
  runReviewCommand,
  type ReviewCommandDependencies,
} from "./review-command.js";

const pullRequest: PullRequestMetadata = {
  additions: 10,
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

describe("review command", () => {
  it("parses review options from argv", () => {
    const options = parseReviewCommandOptions([
      "review",
      "--owner",
      "acme",
      "--repo",
      "widgets",
      "--pull-number",
      "42",
      "--github-token",
      "ghs_token",
      "--dry-run",
      "--min-confidence",
      "0.86",
      "--max-findings",
      "3",
      "--model",
      "gpt-4.1",
      "--output",
      "json",
    ]);

    expect(options).toEqual({
      dryRun: true,
      githubToken: "ghs_token",
      maxFindings: 3,
      minConfidence: 0.86,
      model: "gpt-4.1",
      output: "json",
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });
  });

  it("accepts the npm script separator before review options", () => {
    const options = parseReviewCommandOptions([
      "--",
      "review",
      "--owner",
      "acme",
      "--repo",
      "widgets",
      "--pull-number",
      "42",
      "--github-token",
      "ghs_token",
    ]);

    expect(options).toMatchObject({
      githubToken: "ghs_token",
      owner: "acme",
      pullNumber: 42,
      repo: "widgets",
    });
  });

  it("runs the review pipeline and skips posting in dry-run mode", async () => {
    const postedComments: string[] = [];
    const storedRuns: unknown[] = [];
    const dependencies = createDependencies({
      postComment: async (input) => {
        postedComments.push(input.body);
      },
      storeReviewRun: async (input) => {
        storedRuns.push(input);
      },
    });

    const result = await runReviewCommand(
      {
        dryRun: true,
        githubToken: "ghs_token",
        maxFindings: 1,
        minConfidence: 0.8,
        model: "gpt-4.1",
        output: "markdown",
        owner: "acme",
        pullNumber: 42,
        repo: "widgets",
      },
      dependencies,
    );

    expect(dependencies.runReviewPipelineCalls).toEqual([
      {
        confidenceThreshold: 0.8,
        dryRun: true,
        github: { client: dependencies.githubClient },
        owner: "acme",
        pullNumber: 42,
        repo: "widgets",
      },
    ]);
    expect(postedComments).toEqual([]);
    expect(storedRuns).toHaveLength(1);
    expect(result.posted).toBe(false);
    expect(result.summary).toContain("Dry run: yes");
    expect(result.reviewResult.findings).toHaveLength(1);
  });

  it("posts inline review comments for findings that map to changed diff lines", async () => {
    const createdReviews: CreatePullRequestReviewInput[] = [];
    const dependencies = createDependencies({
      createReview: async (input) => {
        createdReviews.push(input);
      },
    });

    const result = await runReviewCommand(
      {
        dryRun: false,
        githubToken: "ghs_token",
        maxFindings: 5,
        minConfidence: 0.7,
        output: "markdown",
        owner: "acme",
        pullNumber: 42,
        repo: "widgets",
      },
      dependencies,
    );

    expect(createdReviews).toEqual([
      {
        body: result.summary,
        comments: [
          {
            body: "Call requireAdmin() before loading customer records.",
            line: 12,
            path: "src/admin.ts",
            side: "RIGHT",
          },
          {
            body: "The changed branch can throw when the widget is missing.",
            line: 20,
            path: "src/widget.ts",
            side: "RIGHT",
          },
        ],
        event: "COMMENT",
        ref: { owner: "acme", repo: "widgets", number: 42 },
      },
    ]);
    expect(result.posted).toBe(true);
  });

  it("maps findings on renamed files to the current GitHub review path", async () => {
    const createdReviews: CreatePullRequestReviewInput[] = [];
    const dependencies = createDependencies({
      createReview: async (input) => {
        createdReviews.push(input);
      },
      reviewResult: createReviewResult({
        files: [
          {
            additions: 1,
            changes: 2,
            deletions: 1,
            filename: "src/admin.ts",
            patch: "@@ -10,2 +10,3 @@\n const role = user.role;\n+return customer;\n requireAdmin();",
            previousFilename: "src/old-admin.ts",
            sha: "renamed-sha",
            status: "renamed",
          },
        ],
        findings: [
          createFinding({
            filePath: "src/old-admin.ts",
            line: 11,
            title: "Renamed admin route misses authorization",
          }),
        ],
      }),
    });

    await runReviewCommand(
      {
        dryRun: false,
        githubToken: "ghs_token",
        minConfidence: 0.7,
        output: "markdown",
        owner: "acme",
        pullNumber: 42,
        repo: "widgets",
      },
      dependencies,
    );

    expect(createdReviews[0]?.comments).toEqual([
      expect.objectContaining({
        line: 11,
        path: "src/admin.ts",
      }),
    ]);
  });

  it("does not post findings that only target deleted files", async () => {
    const createdReviews: CreatePullRequestReviewInput[] = [];
    const postedComments: PostPullRequestCommentInput[] = [];
    const dependencies = createDependencies({
      createReview: async (input) => {
        createdReviews.push(input);
      },
      postComment: async (input) => {
        postedComments.push(input);
      },
      reviewResult: createReviewResult({
        files: [
          {
            additions: 0,
            changes: 2,
            deletions: 2,
            filename: "src/removed.ts",
            patch: "@@ -1,2 +0,0 @@\n-export const unsafe = true;\n-requireAdmin();",
            sha: "deleted-sha",
            status: "removed",
          },
        ],
        findings: [
          createFinding({
            filePath: "src/removed.ts",
            line: 1,
            title: "Deleted file finding is ignored",
          }),
        ],
      }),
    });

    const result = await runReviewCommand(
      {
        dryRun: false,
        githubToken: "ghs_token",
        minConfidence: 0.7,
        output: "markdown",
        owner: "acme",
        pullNumber: 42,
        repo: "widgets",
      },
      dependencies,
    );

    expect(createdReviews).toEqual([]);
    expect(postedComments).toEqual([]);
    expect(result.posted).toBe(false);
  });

  it("falls back to a summary comment when a finding cannot be mapped to the diff", async () => {
    const createdReviews: CreatePullRequestReviewInput[] = [];
    const postedComments: PostPullRequestCommentInput[] = [];
    const dependencies = createDependencies({
      createReview: async (input) => {
        createdReviews.push(input);
      },
      postComment: async (input) => {
        postedComments.push(input);
      },
      reviewResult: createReviewResult({
        findings: [
          createFinding({
            line: 200,
            title: "Unmapped finding falls back to summary",
          }),
        ],
      }),
    });

    const result = await runReviewCommand(
      {
        dryRun: false,
        githubToken: "ghs_token",
        minConfidence: 0.7,
        output: "markdown",
        owner: "acme",
        pullNumber: 42,
        repo: "widgets",
      },
      dependencies,
    );

    expect(createdReviews).toEqual([]);
    expect(postedComments).toEqual([
      {
        body: result.summary,
        ref: { owner: "acme", repo: "widgets", number: 42 },
      },
    ]);
    expect(result.posted).toBe(true);
  });

  it("does not repost duplicate findings that were already posted on the PR", async () => {
    const createdReviews: CreatePullRequestReviewInput[] = [];
    const postedComments: PostPullRequestCommentInput[] = [];
    const dependencies = createDependencies({
      createReview: async (input) => {
        createdReviews.push(input);
      },
      loadPostedFindingDedupeKeys: async () =>
        new Set(["src/admin.ts:12:authorization:admin route misses authorization"]),
      postComment: async (input) => {
        postedComments.push(input);
      },
    });

    const result = await runReviewCommand(
      {
        dryRun: false,
        githubToken: "ghs_token",
        minConfidence: 0.7,
        output: "markdown",
        owner: "acme",
        pullNumber: 42,
        repo: "widgets",
      },
      dependencies,
    );

    expect(createdReviews[0]?.comments).toHaveLength(1);
    expect(createdReviews[0]?.comments[0]?.path).toBe("src/widget.ts");
    expect(postedComments).toEqual([]);
    expect(result.posted).toBe(true);
  });

  it("does not post more than the configured max findings", async () => {
    const createdReviews: CreatePullRequestReviewInput[] = [];
    const dependencies = createDependencies({
      createReview: async (input) => {
        createdReviews.push(input);
      },
    });

    await runReviewCommand(
      {
        dryRun: false,
        githubToken: "ghs_token",
        maxFindings: 1,
        minConfidence: 0.7,
        output: "markdown",
        owner: "acme",
        pullNumber: 42,
        repo: "widgets",
      },
      dependencies,
    );

    expect(createdReviews[0]?.comments).toHaveLength(1);
    expect(createdReviews[0]?.comments[0]?.path).toBe("src/admin.ts");
  });

  it("stores GitHub review comment IDs with posted findings", async () => {
    const storedRuns: unknown[] = [];
    const dependencies = createDependencies({
      createReview: async () => undefined,
      listReviewComments: async () => [
        {
          body: "Call requireAdmin() before loading customer records.",
          id: 901,
          line: 12,
          path: "src/admin.ts",
          side: "RIGHT",
        },
        {
          body: "The changed branch can throw when the widget is missing.",
          id: 902,
          line: 20,
          path: "src/widget.ts",
          side: "RIGHT",
        },
      ],
      storeReviewRun: async (input) => {
        storedRuns.push(input);
      },
    });

    await runReviewCommand(
      {
        dryRun: false,
        githubToken: "ghs_token",
        minConfidence: 0.7,
        output: "markdown",
        owner: "acme",
        pullNumber: 42,
        repo: "widgets",
      },
      dependencies,
    );

    expect(storedRuns).toEqual([
      expect.objectContaining({
        posted: true,
        postedFindings: [
          expect.objectContaining({
            githubCommentId: "901",
            line: 12,
            path: "src/admin.ts",
          }),
          expect.objectContaining({
            githubCommentId: "902",
            line: 20,
            path: "src/widget.ts",
          }),
        ],
      }),
    ]);
  });

  it("does not store a review run when DATABASE_URL is absent", async () => {
    const storedRuns: unknown[] = [];
    const dependencies = createDependencies({
      env: {},
      storeReviewRun: async (input) => {
        storedRuns.push(input);
      },
    });

    await runReviewCommand(
      {
        dryRun: true,
        githubToken: "ghs_token",
        minConfidence: 0.7,
        output: "json",
        owner: "acme",
        pullNumber: 42,
        repo: "widgets",
      },
      dependencies,
    );

    expect(storedRuns).toEqual([]);
  });

  it("uses OPENAI_API_KEY to run the default pipeline through three LLM review passes without posting in dry-run", async () => {
    const postedComments: PostPullRequestCommentInput[] = [];
    const createdReviews: CreatePullRequestReviewInput[] = [];
    const provider = createFakeLlmProvider([
      {
        findings: [
          createFinding({
            category: "logic",
            title: "Changed null check can throw",
          }),
        ],
      },
      {
        findings: [
          createFinding({
            category: "authorization",
            title: "Admin route returns data before auth",
          }),
        ],
      },
      {
        findings: [
          createFinding({
            category: "testing",
            title: "Behavior change lacks regression coverage",
          }),
        ],
      },
    ]);
    const dependencies = createDependencies({
      createLlmProvider: () => provider,
      createReview: async (input) => {
        createdReviews.push(input);
      },
      env: {
        GITHUB_TOKEN: "ghs_token",
        OPENAI_API_KEY: "sk-test",
      },
      findingValidator: async () => ({
        confidence: 0.96,
        falsePositiveRisk: "low",
        reason: "The changed-code evidence supports posting this candidate.",
        shouldPost: true,
        valid: true,
      }),
      postComment: async (input) => {
        postedComments.push(input);
      },
      runReviewPipeline: undefined,
      storeReviewRun: async () => undefined,
    });

    const result = await runReviewCommand(
      {
        dryRun: true,
        minConfidence: 0.7,
        model: "gpt-test-review",
        output: "json",
        owner: "acme",
        pullNumber: 42,
        repo: "widgets",
      },
      dependencies,
    );

    expect(provider.requests.map((request) => request.messages[0]?.content)).toEqual([
      expect.stringContaining("Focus on logic bugs"),
      expect.stringContaining("Focus on security bugs"),
      expect.stringContaining("Focus on regression risks"),
    ]);
    expect(provider.requests.map((request) => request.model)).toEqual([
      "gpt-test-review",
      "gpt-test-review",
      "gpt-test-review",
    ]);
    expect(result.reviewResult.findings.map((finding) => finding.title)).toEqual([
      "Changed null check can throw",
      "Admin route returns data before auth",
      "Behavior change lacks regression coverage",
    ]);
    expect(result.reviewResult.modelCalls).toHaveLength(3);
    expect(JSON.parse(result.output)).toMatchObject({
      modelCalls: [
        expect.objectContaining({
          provider: "openai",
          promptVersion: "review-v1",
          status: "succeeded",
          templateId: "logic-bugs",
        }),
        expect.objectContaining({ templateId: "security-bugs" }),
        expect.objectContaining({ templateId: "regression-test-gaps" }),
      ],
      posted: false,
    });
    expect(createdReviews).toEqual([]);
    expect(postedComments).toEqual([]);
  });

  it("formats a low-noise markdown summary", () => {
    const summary = buildMarkdownSummary(createReviewResult(), {
      dryRun: true,
      maxFindings: 1,
      minConfidence: 0.8,
      model: "gpt-4.1",
    });

    expect(summary).toContain("## DiffGuard-AI Review");
    expect(summary).toContain("Findings: 1");
    expect(summary).toContain("Rules: .diffguard-rules.md found");
    expect(summary).toContain("1. **Admin route misses authorization**");
    expect(summary).not.toContain("Second finding should be trimmed");
  });
});

function createDependencies(
  overrides: Partial<ReviewCommandDependencies> & {
    createReview?: (input: CreatePullRequestReviewInput) => Promise<void>;
    listReviewComments?: () => Promise<
      Array<{ body?: string; id: number; line?: number; path: string; side?: "LEFT" | "RIGHT" }>
    >;
    postComment?: (input: PostPullRequestCommentInput) => Promise<void>;
    reviewResult?: ReviewResult;
  } = {},
): ReviewCommandDependencies & {
  githubClient: DiffGuardGitHubClient;
  runReviewPipelineCalls: unknown[];
} {
  const githubClient = {
    createPullRequestReview: async (input: CreatePullRequestReviewInput) => {
      await overrides.createReview?.(input);

      return {
        ok: true,
        data: {
          body: input.body,
          htmlUrl: "https://github.com/acme/widgets/pull/42#pullrequestreview-9",
          id: 9,
          state: "COMMENTED",
        },
      };
    },
    getPullRequestMetadata: async () => ({
      ok: true,
      data: pullRequest,
    }),
    listPullRequestFiles: async () => ({
      ok: true,
      data: createReviewResult().context.files,
    }),
    listPullRequestReviewComments: async () => ({
      ok: true,
      data: overrides.listReviewComments
        ? await overrides.listReviewComments()
        : [
            {
              body: "Call requireAdmin() before loading customer records.",
              htmlUrl: "https://github.com/acme/widgets/pull/42#discussion_r901",
              id: 901,
              line: 12,
              path: "src/admin.ts",
              side: "RIGHT",
            },
            {
              body: "The changed branch can throw when the widget is missing.",
              htmlUrl: "https://github.com/acme/widgets/pull/42#discussion_r902",
              id: 902,
              line: 20,
              path: "src/widget.ts",
              side: "RIGHT",
            },
          ],
    }),
    postPullRequestComment: async ({ body }: PostPullRequestCommentInput) => {
      const input = {
        body,
        ref: { owner: "acme", repo: "widgets", number: 42 },
      };
      await overrides.postComment?.(input);

      return {
        ok: true,
        data: {
          body,
          htmlUrl: "https://github.com/acme/widgets/pull/42#issuecomment-1",
          id: 1,
        },
      };
    },
    readDiffGuardRules: async () => ({
      ok: true,
      data: "Only comment when confidence is high.",
    }),
  } as unknown as DiffGuardGitHubClient;
  const runReviewPipelineCalls: unknown[] = [];

  return {
    createGitHubClient: () => githubClient,
    env: { DATABASE_URL: "postgres://example" },
    githubClient,
    loadPostedFindingDedupeKeys: async () => new Set<string>(),
    runReviewPipeline: async (input) => {
      runReviewPipelineCalls.push(input);

      return overrides.reviewResult ?? createReviewResult();
    },
    runReviewPipelineCalls,
    storeReviewRun: overrides.storeReviewRun ?? (async () => undefined),
    ...overrides,
  };
}

function createReviewResult(
  overrides: {
    files?: ReviewResult["context"]["files"];
    findings?: ReviewResult["findings"];
  } = {},
): ReviewResult {
  const files = overrides.files ?? [
    {
      additions: 1,
      changes: 3,
      deletions: 0,
      filename: "src/admin.ts",
      patch: "@@ -10,2 +10,3 @@\n const role = user.role;\n+return customer;\n requireAdmin();",
      sha: "admin-sha",
      status: "modified",
    },
    {
      additions: 1,
      changes: 3,
      deletions: 0,
      filename: "src/widget.ts",
      patch: "@@ -19,2 +19,3 @@\n const widget = findWidget();\n+return widget.name;\n return fallback;",
      sha: "widget-sha",
      status: "modified",
    },
  ];
  const findings = overrides.findings ?? [
    createFinding(),
      createFinding({
        category: "logic",
        confidence: 0.9,
        evidence: "The changed branch skips the null guard before property access.",
        filePath: "src/widget.ts",
        improvedComment: undefined,
        line: 20,
      relatedRuleIds: [],
      severity: "medium",
      suggestedFix: "Restore the null guard before reading the property.",
      summary: "The changed branch can throw when the widget is missing.",
      title: "Second finding should be trimmed",
      whyItMatters: "A missing widget would crash the request.",
    }),
  ];

  return {
    context: {
      dryRun: true,
      files,
      pullRequest,
      ref: { owner: "acme", repo: "widgets", number: 42 },
      rules: {
        content: "Only comment when confidence is high.",
        found: true,
        path: ".diffguard-rules.md",
      },
    },
    dryRun: true,
    findings,
    modelCalls: [],
    pullRequest,
    rejectedFindings: [{ reason: "low_confidence", title: "Speculative issue" }],
    timings: [
      {
        completedAt: "2026-06-20T00:00:00.010Z",
        durationMs: 10,
        stage: "fetch_pull_request",
        startedAt: "2026-06-20T00:00:00.000Z",
      },
    ],
  };
}

function createFinding(overrides: Partial<ReviewResult["findings"][number]> = {}): ReviewResult["findings"][number] {
  return {
    category: "authorization",
    confidence: 0.94,
    evidence: "The diff returns customer data before requireAdmin() runs.",
    filePath: "src/admin.ts",
    improvedComment: "Call requireAdmin() before loading customer records.",
    line: 12,
    relatedRuleIds: ["repo-rule-admin-auth"],
    severity: "high",
    side: "RIGHT",
    suggestedFix: "Move requireAdmin() before the customer lookup.",
    summary: "The admin route returns customer data before checking admin access.",
    title: "Admin route misses authorization",
    whyItMatters: "Non-admin users could read private customer data.",
    ...overrides,
  };
}

type FakeLlmOutput = {
  findings: ReviewResult["findings"];
};

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
