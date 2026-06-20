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
        new Set(["src/admin.ts:12:authorization:admin route misses authorization"]),
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
          dedupeKey: "src/admin.ts:12:authorization:admin route misses authorization",
          githubCommentId: "901",
          line: 12,
          path: "src/admin.ts",
        },
      ],
      result: createReviewResult({ findings: [createFinding()] }),
    });

    expect(calls).toEqual(["repository.upsert", "pullRequest.upsert", "reviewRun.create", "finding.createMany"]);
    expect(prisma.findingCreateManyInput?.data[0]).toMatchObject({
      dedupeKey: "src/admin.ts:12:authorization:admin route misses authorization",
      githubCommentId: "901",
      status: "POSTED",
    });
    expect(prisma.disconnected).toBe(true);
  });

  it("loads posted finding dedupe keys from Prisma", async () => {
    const prisma = createPrismaDouble([]);
    prisma.findingFindManyResult = [
      { dedupeKey: "src/admin.ts:12:authorization:admin route misses authorization" },
    ];

    const keys = await loadPostedFindingDedupeKeysFromDatabase({
      database: prisma,
      ref: { owner: "acme", repo: "widgets", number: 42 },
    });

    expect([...keys]).toEqual(["src/admin.ts:12:authorization:admin route misses authorization"]);
    expect(prisma.findingFindManyInput?.where.reviewRun.pullRequest.repository).toEqual({
      name: "widgets",
      owner: "acme",
    });
    expect(prisma.disconnected).toBe(true);
  });

  it("formats summaries and stable dedupe keys", () => {
    expect(buildFindingDedupeKey(createFinding())).toBe(
      "src/admin.ts:12:authorization:admin route misses authorization",
    );
    expect(
      buildMarkdownSummary(createReviewResult(), { dryRun: true, minConfidence: 0.8 }),
    ).toContain("## DiffGuard-AI Review");
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

function createPrismaDouble(calls: string[]): PrismaClientLike & {
  disconnected: boolean;
  findingCreateManyInput?: Parameters<PrismaClientLike["finding"]["createMany"]>[0];
  findingFindManyInput?: Parameters<PrismaClientLike["finding"]["findMany"]>[0];
  findingFindManyResult: Array<{ dedupeKey: string }>;
} {
  const prisma: PrismaClientLike & {
    disconnected: boolean;
    findingCreateManyInput?: Parameters<PrismaClientLike["finding"]["createMany"]>[0];
    findingFindManyInput?: Parameters<PrismaClientLike["finding"]["findMany"]>[0];
    findingFindManyResult: Array<{ dedupeKey: string }>;
  } = {
    disconnected: false,
    findingCreateManyInput: undefined,
    findingFindManyInput: undefined,
    findingFindManyResult: [],
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
    },
  };

  return prisma;
}
