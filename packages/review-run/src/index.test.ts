import { describe, expect, it } from "vitest";

import type {
  CreatePullRequestReviewInput,
  DiffGuardGitHubClient,
  PostPullRequestCommentInput,
  PullRequestComment,
  PullRequestMetadata,
  PullRequestReview,
} from "@diffguard/github";
import type { ReviewResult } from "@diffguard/reviewer";

import {
  buildFindingDedupeKey,
  buildMarkdownSummary,
  finalizeReviewRun,
  loadPostedFindingDedupeKeysFromDatabase,
  markReviewRunFailedInDatabase,
  planReviewPosting,
  storeReviewRunInDatabase,
  type PrismaClientLike,
} from "./index.js";

const pullRequest: PullRequestMetadata = {
  additions: 10,
  authorLogin: "octocat",
  baseRef: "main",
  baseSha: "base-sha",
  changedFiles: 2,
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

describe("review-run finalization", () => {
  it("posts inline comments, falls back for unmapped findings, and stores posted comment IDs", async () => {
    const createdReviews: CreatePullRequestReviewInput[] = [];
    const postedComments: PostPullRequestCommentInput[] = [];
    const storedRuns: unknown[] = [];
    const githubClient = createGitHubClientDouble({
      createReview: async (input) => {
        createdReviews.push(input);
      },
      postComment: async (input) => {
        postedComments.push(input);
      },
    });
    const result = createReviewResult({
      findings: [
        createFinding(),
        createFinding({
          filePath: "src/missing.ts",
          line: 99,
          title: "Unmapped finding uses fallback",
        }),
      ],
    });

    const finalized = await finalizeReviewRun({
      dryRun: false,
      githubClient,
      maxFindings: 5,
      minConfidence: 0.7,
      ref: { owner: "acme", repo: "widgets", number: 42 },
      result,
      storeReviewRun: async (input) => {
        storedRuns.push(input);
      },
    });

    expect(createdReviews).toEqual([
      expect.objectContaining({
        comments: [
          {
            body: "Call requireAdmin() before loading customer records.",
            line: 12,
            path: "src/admin.ts",
            side: "RIGHT",
          },
        ],
      }),
    ]);
    expect(postedComments).toEqual([
      expect.objectContaining({
        body: expect.stringContaining("Unmapped finding uses fallback"),
      }),
    ]);
    expect(finalized.posted).toBe(true);
    expect(finalized.postedFindings).toEqual([
      expect.objectContaining({ githubCommentId: "901", line: 12, path: "src/admin.ts" }),
      expect.objectContaining({ githubCommentId: "1", line: 99, path: "src/missing.ts" }),
    ]);
    expect(storedRuns).toEqual([
      expect.objectContaining({
        posted: true,
        postedFindings: finalized.postedFindings,
      }),
    ]);
  });

  it("skips duplicate persisted findings before posting", async () => {
    const createdReviews: CreatePullRequestReviewInput[] = [];
    const finalized = await finalizeReviewRun({
      dryRun: false,
      githubClient: createGitHubClientDouble({
        createReview: async (input) => {
          createdReviews.push(input);
        },
      }),
      loadPostedFindingDedupeKeys: async () =>
        new Set(["acme/widgets#42:src/admin.ts:12:authorization:admin route misses authorization"]),
      ref: { owner: "acme", repo: "widgets", number: 42 },
      result: createReviewResult(),
    });

    expect(createdReviews[0]?.comments).toEqual([
      expect.objectContaining({
        path: "src/widget.ts",
      }),
    ]);
    expect(finalized.result.findings.map((finding) => finding.filePath)).toEqual(["src/widget.ts"]);
  });

  it("does not skip the same normalized title on a different file", async () => {
    const createdReviews: CreatePullRequestReviewInput[] = [];
    const sameTitleDifferentFile = createFinding({
      category: "authorization",
      evidence: "The widget route also returns data before requireAdmin() runs.",
      filePath: "src/widget.ts",
      improvedComment: "Call requireAdmin() before returning widget data.",
      line: 20,
      summary: "The widget route returns data before checking admin access.",
      title: "Admin route misses authorization",
      whyItMatters: "Non-admin users could read private widget data.",
    });

    const finalized = await finalizeReviewRun({
      dryRun: false,
      githubClient: createGitHubClientDouble({
        createReview: async (input) => {
          createdReviews.push(input);
        },
      }),
      loadPostedFindingDedupeKeys: async () =>
        new Set(["acme/widgets#42:src/admin.ts:12:authorization:admin route misses authorization"]),
      ref: { owner: "acme", repo: "widgets", number: 42 },
      result: createReviewResult({
        findings: [createFinding(), sameTitleDifferentFile],
      }),
    });

    expect(createdReviews[0]?.comments).toEqual([
      expect.objectContaining({
        body: "Call requireAdmin() before returning widget data.",
        path: "src/widget.ts",
      }),
    ]);
    expect(finalized.result.findings).toEqual([sameTitleDifferentFile]);
  });

  it("does not post comments in dry-run mode but can store the review run", async () => {
    const createdReviews: CreatePullRequestReviewInput[] = [];
    const storedRuns: unknown[] = [];
    const finalized = await finalizeReviewRun({
      dryRun: true,
      githubClient: createGitHubClientDouble({
        createReview: async (input) => {
          createdReviews.push(input);
        },
      }),
      ref: { owner: "acme", repo: "widgets", number: 42 },
      result: createReviewResult(),
      storeReviewRun: async (input) => {
        storedRuns.push(input);
      },
    });

    expect(createdReviews).toEqual([]);
    expect(finalized.posted).toBe(false);
    expect(storedRuns).toEqual([
      expect.objectContaining({
        posted: false,
        postedFindings: [],
      }),
    ]);
  });

  it("stores review runs and posted finding IDs in Prisma", async () => {
    const calls: string[] = [];
    const prisma = createPrismaDouble(calls);

    await storeReviewRunInDatabase({
      database: prisma,
      posted: true,
      postedFindings: [
        {
          dedupeKey: "acme/widgets#42:src/admin.ts:12:authorization:admin route misses authorization",
          githubCommentId: "901",
          line: 12,
          path: "src/admin.ts",
        },
      ],
      result: createReviewResult({ findings: [createFinding()] }),
    });

    expect(calls).toEqual([
      "repository.upsert",
      "pullRequest.upsert",
      "reviewRun.create",
      "finding.createMany",
      "validatorDecision.createMany",
    ]);
    expect(prisma.findingCreateManyInput?.data[0]).toMatchObject({
      dedupeKey: "acme/widgets#42:src/admin.ts:12:authorization:admin route misses authorization",
      githubCommentId: "901",
      status: "POSTED",
    });
    expect(prisma.disconnected).toBe(true);
  });

  it("updates an existing queued review run and stores model-call telemetry", async () => {
    const calls: string[] = [];
    const prisma = createPrismaDouble(calls);

    await storeReviewRunInDatabase({
      database: prisma,
      posted: true,
      postedFindings: [
        {
          dedupeKey: "acme/widgets#42:src/admin.ts:12:authorization:admin route misses authorization",
          githubCommentId: "901",
          line: 12,
          path: "src/admin.ts",
        },
      ],
      result: createReviewResult({
        findings: [createFinding()],
        modelCalls: [
          {
            attempt: 1,
            costUsd: 0.00042,
            latencyMs: 1200,
            model: "gpt-test",
            promptVersion: "review-v1",
            provider: "openai",
            status: "succeeded",
            tokenUsage: {
              inputTokens: 100,
              outputTokens: 20,
              totalTokens: 120,
            },
          },
          {
            attempt: 1,
            costUsd: 0,
            latencyMs: 600,
            model: "gpt-test",
            promptVersion: "review-v1",
            provider: "openai",
            status: "invalid_output",
            tokenUsage: {
              inputTokens: 50,
              outputTokens: 10,
              totalTokens: 60,
            },
          },
        ],
      }),
      reviewRunId: "review_run_existing",
    });

    expect(calls).toEqual([
      "repository.upsert",
      "pullRequest.upsert",
      "reviewRun.update",
      "finding.createMany",
      "modelCall.createMany",
      "validatorDecision.createMany",
    ]);
    expect(prisma.reviewRunUpdateInput).toMatchObject({
      data: {
        findingsDetected: 2,
        findingsPosted: 1,
        status: "COMPLETED",
        totalCostUsd: 0.00042,
        validatorRejectionRate: 0,
      },
      where: { id: "review_run_existing" },
    });
    expect(prisma.findingCreateManyInput?.data[0]).toMatchObject({
      reviewRunId: "review_run_existing",
      status: "POSTED",
    });
    expect(prisma.modelCallCreateManyInput?.data).toEqual([
      expect.objectContaining({
        costUsd: 0.00042,
        errorCode: undefined,
        inputTokens: 100,
        modelName: "gpt-test",
        outputTokens: 20,
        promptVersion: "review-v1",
        provider: "openai",
        reviewRunId: "review_run_existing",
        status: "SUCCEEDED",
        totalTokens: 120,
      }),
      expect.objectContaining({
        errorCode: "invalid_output",
        reviewRunId: "review_run_existing",
        status: "FAILED",
      }),
    ]);
    expect(prisma.validatorDecisionCreateManyInput?.data).toEqual([
      expect.objectContaining({
        confidence: 0.94,
        decision: "accepted",
        findingTitle: "Admin route misses authorization",
        reason: "Validated finding retained for posting.",
        reviewRunId: "review_run_existing",
        valid: true,
      }),
      expect.objectContaining({
        decision: "rejected",
        findingTitle: "Speculative issue",
        reason: "low_confidence",
        reviewRunId: "review_run_existing",
        shouldPost: false,
        valid: false,
      }),
    ]);
    expect(prisma.disconnected).toBe(true);
  });

  it("marks existing review runs failed in Prisma with a sanitized error message", async () => {
    const calls: string[] = [];
    const prisma = createPrismaDouble(calls);

    await markReviewRunFailedInDatabase({
      database: prisma,
      error: new Error("OpenAI key sk-live-secret leaked in stack trace"),
      reviewRunId: "review_run_existing",
    });

    expect(calls).toEqual(["reviewRun.update"]);
    expect(prisma.reviewRunUpdateInput).toMatchObject({
      data: {
        errorMessage: "OpenAI key [redacted] leaked in stack trace",
        status: "FAILED",
      },
      where: { id: "review_run_existing" },
    });
    expect(prisma.reviewRunUpdateInput?.data.completedAt).toBeInstanceOf(Date);
    expect(prisma.disconnected).toBe(true);
  });

  it("loads posted finding dedupe keys from Prisma", async () => {
    const prisma = createPrismaDouble([]);
    prisma.findingFindManyResult = [
      { dedupeKey: "acme/widgets#42:src/admin.ts:12:authorization:admin route misses authorization" },
    ];

    const keys = await loadPostedFindingDedupeKeysFromDatabase({
      database: prisma,
      ref: { owner: "acme", repo: "widgets", number: 42 },
    });

    expect([...keys]).toEqual([
      "acme/widgets#42:src/admin.ts:12:authorization:admin route misses authorization",
    ]);
    expect(prisma.findingFindManyInput?.where.reviewRun.pullRequest.repository).toEqual({
      name: "widgets",
      owner: "acme",
    });
    expect(prisma.disconnected).toBe(true);
  });

  it("formats summaries and stable dedupe keys", () => {
    expect(
      buildFindingDedupeKey({ owner: "acme", repo: "widgets", number: 42 }, createFinding()),
    ).toBe(
      "acme/widgets#42:src/admin.ts:12:authorization:admin route misses authorization",
    );
    expect(
      buildMarkdownSummary(createReviewResult(), { dryRun: true, minConfidence: 0.8 }),
    ).toContain("## DiffGuard-AI Review");
  });

  it("maps findings to valid inline diff lines", () => {
    const planned = planReviewPosting(createReviewResult());

    expect(planned.inline).toEqual([
      expect.objectContaining({
        comment: expect.objectContaining({
          line: 12,
          path: "src/admin.ts",
          side: "RIGHT",
        }),
      }),
      expect.objectContaining({
        comment: expect.objectContaining({
          line: 20,
          path: "src/widget.ts",
          side: "RIGHT",
        }),
      }),
    ]);
    expect(planned.fallback).toEqual([]);
  });

  it("falls back to a summary comment when a changed diff line is no longer available", async () => {
    const createdReviews: CreatePullRequestReviewInput[] = [];
    const postedComments: PostPullRequestCommentInput[] = [];

    const finalized = await finalizeReviewRun({
      dryRun: false,
      githubClient: createGitHubClientDouble({
        createReview: async (input) => {
          createdReviews.push(input);
        },
        postComment: async (input) => {
          postedComments.push(input);
        },
      }),
      ref: { owner: "acme", repo: "widgets", number: 42 },
      result: createReviewResult({
        findings: [
          createFinding({
            line: 44,
            summary: "The finding references a line that is no longer in the latest PR diff.",
            title: "Changed line no longer available",
          }),
        ],
      }),
    });

    expect(createdReviews).toEqual([]);
    expect(postedComments).toEqual([
      expect.objectContaining({
        body: expect.stringContaining("Changed line no longer available"),
      }),
    ]);
    expect(finalized.postedFindings).toEqual([
      expect.objectContaining({
        githubCommentId: "1",
        line: 44,
        path: "src/admin.ts",
      }),
    ]);
  });
});

function createGitHubClientDouble(input: {
  createReview?: (input: CreatePullRequestReviewInput) => Promise<void>;
  postComment?: (input: PostPullRequestCommentInput) => Promise<void>;
} = {}): DiffGuardGitHubClient {
  return {
    createPullRequestReview: async (
      reviewInput: CreatePullRequestReviewInput,
    ): Promise<{ ok: true; data: PullRequestReview }> => {
      await input.createReview?.(reviewInput);

      return {
        ok: true,
        data: {
          body: reviewInput.body,
          htmlUrl: "https://github.com/acme/widgets/pull/42#pullrequestreview-9",
          id: 9,
          state: "COMMENTED",
        },
      };
    },
    listPullRequestReviewComments: async () => ({
      ok: true,
      data: [
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
    postPullRequestComment: async ({
      body,
      ref,
    }: PostPullRequestCommentInput): Promise<{ ok: true; data: PullRequestComment }> => {
      await input.postComment?.({ body, ref });

      return {
        ok: true,
        data: {
          body,
          htmlUrl: "https://github.com/acme/widgets/pull/42#issuecomment-1",
          id: 1,
        },
      };
    },
  } as unknown as DiffGuardGitHubClient;
}

function createReviewResult(
  overrides: {
    findings?: ReviewResult["findings"];
    modelCalls?: ReviewResult["modelCalls"];
  } = {},
): ReviewResult {
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
      diff: [
        "diff --git a/src/admin.ts b/src/admin.ts",
        "@@ -10,2 +10,3 @@\n const role = user.role;\n+return customer;\n requireAdmin();",
        "diff --git a/src/widget.ts b/src/widget.ts",
        "@@ -19,2 +19,3 @@\n const widget = findWidget();\n+return widget.name;\n return fallback;",
      ].join("\n"),
      dryRun: false,
      files: [
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
      ],
      pullRequest,
      ref: { owner: "acme", repo: "widgets", number: 42 },
      rules: {
        content: "Only comment when confidence is high.",
        found: true,
        path: ".diffguard-rules.md",
      },
    },
    dryRun: false,
    findings,
    modelCalls: overrides.modelCalls ?? [],
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

function createPrismaDouble(calls: string[]): PrismaClientLike & {
  disconnected: boolean;
  findingCreateManyInput?: Parameters<PrismaClientLike["finding"]["createMany"]>[0];
  findingFindManyInput?: Parameters<PrismaClientLike["finding"]["findMany"]>[0];
  findingFindManyResult: Array<{ dedupeKey: string }>;
  modelCallCreateManyInput?: Parameters<PrismaClientLike["modelCall"]["createMany"]>[0];
  reviewRunUpdateInput?: Parameters<PrismaClientLike["reviewRun"]["update"]>[0];
  validatorDecisionCreateManyInput?: {
    data: unknown[];
    skipDuplicates: boolean;
  };
} {
  const prisma: PrismaClientLike & {
    disconnected: boolean;
    findingCreateManyInput?: Parameters<PrismaClientLike["finding"]["createMany"]>[0];
    findingFindManyInput?: Parameters<PrismaClientLike["finding"]["findMany"]>[0];
    findingFindManyResult: Array<{ dedupeKey: string }>;
    modelCallCreateManyInput?: Parameters<PrismaClientLike["modelCall"]["createMany"]>[0];
    reviewRunUpdateInput?: Parameters<PrismaClientLike["reviewRun"]["update"]>[0];
    validatorDecisionCreateManyInput?: {
      data: unknown[];
      skipDuplicates: boolean;
    };
  } = {
    disconnected: false,
    findingCreateManyInput: undefined,
    findingFindManyInput: undefined,
    findingFindManyResult: [],
    modelCallCreateManyInput: undefined,
    reviewRunUpdateInput: undefined,
    validatorDecisionCreateManyInput: undefined,
    async $disconnect() {
      prisma.disconnected = true;
    },
    finding: {
      createMany: async (input) => {
        calls.push("finding.createMany");
        prisma.findingCreateManyInput = input;
      },
      findMany: async (input) => {
        prisma.findingFindManyInput = input;
        return prisma.findingFindManyResult;
      },
    },
    modelCall: {
      createMany: async (input) => {
        calls.push("modelCall.createMany");
        prisma.modelCallCreateManyInput = input;
      },
    },
    pullRequest: {
      upsert: async () => {
        calls.push("pullRequest.upsert");
        return { id: "pull_request_1" };
      },
    },
    repository: {
      upsert: async () => {
        calls.push("repository.upsert");
        return { id: "repository_1" };
      },
    },
    reviewRun: {
      create: async () => {
        calls.push("reviewRun.create");
        return { id: "review_run_1" };
      },
      update: async (input) => {
        calls.push("reviewRun.update");
        prisma.reviewRunUpdateInput = input;
        return { id: input.where.id };
      },
    },
    validatorDecision: {
      createMany: async (input: { data: unknown[]; skipDuplicates: boolean }) => {
        calls.push("validatorDecision.createMany");
        prisma.validatorDecisionCreateManyInput = input;
      },
    },
  };

  return prisma;
}
