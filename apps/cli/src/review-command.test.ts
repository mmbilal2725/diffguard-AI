import { describe, expect, it } from "vitest";

import type { DiffGuardGitHubClient, PullRequestMetadata } from "@diffguard/github";
import type { ReviewResult } from "@diffguard/reviewer";

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
      postComment: async (body) => {
        postedComments.push(body);
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

  it("posts one summary comment when dry-run is disabled", async () => {
    const postedComments: string[] = [];
    const dependencies = createDependencies({
      postComment: async (body) => {
        postedComments.push(body);
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

    expect(postedComments).toHaveLength(1);
    expect(postedComments[0]).toBe(result.summary);
    expect(result.posted).toBe(true);
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
    postComment?: (body: string) => Promise<void>;
  } = {},
): ReviewCommandDependencies & {
  githubClient: DiffGuardGitHubClient;
  runReviewPipelineCalls: unknown[];
} {
  const githubClient = {
    postPullRequestComment: async ({ body }) => {
      await overrides.postComment?.(body);

      return {
        ok: true,
        data: {
          body,
          htmlUrl: "https://github.com/acme/widgets/pull/42#issuecomment-1",
          id: 1,
        },
      };
    },
  } as DiffGuardGitHubClient;
  const runReviewPipelineCalls: unknown[] = [];

  return {
    createGitHubClient: () => githubClient,
    env: { DATABASE_URL: "postgres://example" },
    githubClient,
    runReviewPipeline: async (input) => {
      runReviewPipelineCalls.push(input);

      return createReviewResult();
    },
    runReviewPipelineCalls,
    storeReviewRun: overrides.storeReviewRun ?? (async () => undefined),
    ...overrides,
  };
}

function createReviewResult(): ReviewResult {
  return {
    context: {
      dryRun: true,
      files: [],
      pullRequest,
      ref: { owner: "acme", repo: "widgets", number: 42 },
      rules: {
        content: "Only comment when confidence is high.",
        found: true,
        path: ".diffguard-rules.md",
      },
    },
    dryRun: true,
    findings: [
      {
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
      },
      {
        category: "logic",
        confidence: 0.9,
        evidence: "The changed branch skips the null guard before property access.",
        filePath: "src/widget.ts",
        line: 20,
        relatedRuleIds: [],
        severity: "medium",
        side: "RIGHT",
        suggestedFix: "Restore the null guard before reading the property.",
        summary: "The changed branch can throw when the widget is missing.",
        title: "Second finding should be trimmed",
        whyItMatters: "A missing widget would crash the request.",
      },
    ],
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
