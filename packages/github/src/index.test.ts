import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  buildPullRequestKey,
  createGitHubAppInstallationToken,
  createGitHubClient,
} from "./index.js";

function createMockOctokit() {
  return {
    paginate: vi.fn(),
    request: vi.fn(),
    rest: {
      issues: {
        createComment: vi.fn(),
      },
      pulls: {
        createReview: vi.fn(),
        get: vi.fn(),
        listFiles: vi.fn(),
      },
      repos: {
        getContent: vi.fn(),
      },
    },
  };
}

describe("buildPullRequestKey", () => {
  it("builds a stable repository pull request key", () => {
    expect(buildPullRequestKey({ owner: "openai", repo: "codex", number: 17 })).toBe(
      "openai/codex#17",
    );
  });
});

describe("createGitHubAppInstallationToken", () => {
  it("exchanges a GitHub App JWT for an installation token", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({
        expires_at: "2026-06-20T00:00:00Z",
        token: "ghs_installation_token",
      }),
      ok: true,
      status: 201,
    }));

    const token = await createGitHubAppInstallationToken({
      appId: "12345",
      fetchImpl,
      installationId: "98765",
      privateKey: privateKeyPem,
    });

    expect(token).toEqual({
      expiresAt: "2026-06-20T00:00:00Z",
      token: "ghs_installation_token",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/app/installations/98765/access_tokens",
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: "application/vnd.github+json",
          authorization: expect.stringMatching(/^Bearer [^.]+\.[^.]+\.[^.]+$/),
        }),
        method: "POST",
      }),
    );
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain(privateKeyPem);
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("ghs_installation_token");
  });
});

describe("createGitHubClient", () => {
  it("gets normalized pull request metadata", async () => {
    const octokit = createMockOctokit();
    octokit.rest.pulls.get.mockResolvedValue({
      data: {
        additions: 12,
        base: { ref: "main", sha: "base-sha" },
        changed_files: 2,
        deletions: 4,
        draft: false,
        head: { ref: "feature", sha: "head-sha" },
        html_url: "https://github.com/acme/widgets/pull/42",
        id: 123,
        number: 42,
        state: "open",
        title: "Fix checkout",
        user: { login: "octocat" },
      },
    });

    const client = createGitHubClient({ octokit });
    const result = await client.getPullRequestMetadata({
      owner: "acme",
      repo: "widgets",
      number: 42,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        additions: 12,
        authorLogin: "octocat",
        baseRef: "main",
        baseSha: "base-sha",
        changedFiles: 2,
        deletions: 4,
        draft: false,
        headRef: "feature",
        headSha: "head-sha",
        htmlUrl: "https://github.com/acme/widgets/pull/42",
        id: 123,
        number: 42,
        state: "open",
        title: "Fix checkout",
      },
    });
    expect(octokit.rest.pulls.get).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      pull_number: 42,
    });
  });

  it("lists pull request files using Octokit pagination", async () => {
    const octokit = createMockOctokit();
    octokit.paginate.mockResolvedValue([
      {
        additions: 3,
        changes: 4,
        deletions: 1,
        filename: "src/payments.ts",
        patch: "@@ -1 +1 @@",
        previous_filename: undefined,
        sha: "abc",
        status: "modified",
      },
      {
        additions: 10,
        changes: 10,
        deletions: 0,
        filename: "src/new.ts",
        patch: undefined,
        previous_filename: "src/old.ts",
        sha: "def",
        status: "renamed",
      },
    ]);

    const client = createGitHubClient({ octokit });
    const result = await client.listPullRequestFiles({
      owner: "acme",
      repo: "widgets",
      number: 42,
    });

    expect(result).toEqual({
      ok: true,
      data: [
        {
          additions: 3,
          changes: 4,
          deletions: 1,
          filename: "src/payments.ts",
          patch: "@@ -1 +1 @@",
          previousFilename: undefined,
          sha: "abc",
          status: "modified",
        },
        {
          additions: 10,
          changes: 10,
          deletions: 0,
          filename: "src/new.ts",
          patch: undefined,
          previousFilename: "src/old.ts",
          sha: "def",
          status: "renamed",
        },
      ],
    });
    expect(octokit.paginate).toHaveBeenCalledWith(octokit.rest.pulls.listFiles, {
      owner: "acme",
      per_page: 100,
      pull_number: 42,
      repo: "widgets",
    });
  });

  it("fetches a pull request diff with the GitHub diff media type", async () => {
    const octokit = createMockOctokit();
    octokit.request.mockResolvedValue({
      data: "diff --git a/src/file.ts b/src/file.ts",
    });

    const client = createGitHubClient({ octokit });
    const result = await client.fetchPullRequestDiff({
      owner: "acme",
      repo: "widgets",
      number: 42,
    });

    expect(result).toEqual({
      ok: true,
      data: "diff --git a/src/file.ts b/src/file.ts",
    });
    expect(octokit.request).toHaveBeenCalledWith("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      headers: { accept: "application/vnd.github.v3.diff" },
      owner: "acme",
      pull_number: 42,
      repo: "widgets",
    });
  });

  it("reads and decodes a file from a repository ref", async () => {
    const octokit = createMockOctokit();
    octokit.rest.repos.getContent.mockResolvedValue({
      data: {
        content: Buffer.from("export const value = 1;\n", "utf8").toString("base64"),
        encoding: "base64",
        html_url: "https://github.com/acme/widgets/blob/head/src/file.ts",
        path: "src/file.ts",
        sha: "file-sha",
        size: 24,
        type: "file",
      },
    });

    const client = createGitHubClient({ octokit });
    const result = await client.readFileAtRef({
      owner: "acme",
      repo: "widgets",
      path: "src/file.ts",
      ref: "head-sha",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        content: "export const value = 1;\n",
        encoding: "base64",
        htmlUrl: "https://github.com/acme/widgets/blob/head/src/file.ts",
        path: "src/file.ts",
        sha: "file-sha",
        size: 24,
      },
    });
  });

  it("returns null when .diffguard-rules.md is missing", async () => {
    const octokit = createMockOctokit();
    octokit.rest.repos.getContent.mockRejectedValue({ status: 404, message: "Not Found" });

    const client = createGitHubClient({ octokit });
    const result = await client.readDiffGuardRules({
      owner: "acme",
      repo: "widgets",
      ref: "head-sha",
    });

    expect(result).toEqual({ ok: true, data: null });
    expect(octokit.rest.repos.getContent).toHaveBeenCalledWith({
      owner: "acme",
      path: ".diffguard-rules.md",
      ref: "head-sha",
      repo: "widgets",
    });
  });

  it("posts a general pull request comment", async () => {
    const octokit = createMockOctokit();
    octokit.rest.issues.createComment.mockResolvedValue({
      data: {
        body: "Review queued.",
        html_url: "https://github.com/acme/widgets/pull/42#issuecomment-1",
        id: 1,
      },
    });

    const client = createGitHubClient({ octokit });
    const result = await client.postPullRequestComment({
      body: "Review queued.",
      ref: { owner: "acme", repo: "widgets", number: 42 },
    });

    expect(result).toEqual({
      ok: true,
      data: {
        body: "Review queued.",
        htmlUrl: "https://github.com/acme/widgets/pull/42#issuecomment-1",
        id: 1,
      },
    });
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: "Review queued.",
      issue_number: 42,
      owner: "acme",
      repo: "widgets",
    });
  });

  it("creates a pull request review with inline comments", async () => {
    const octokit = createMockOctokit();
    octokit.rest.pulls.createReview.mockResolvedValue({
      data: {
        body: "Found one high-confidence issue.",
        html_url: "https://github.com/acme/widgets/pull/42#pullrequestreview-9",
        id: 9,
        state: "COMMENTED",
      },
    });

    const client = createGitHubClient({ octokit });
    const result = await client.createPullRequestReview({
      body: "Found one high-confidence issue.",
      comments: [
        {
          body: "This can skip authorization for admin routes.",
          line: 27,
          path: "src/routes/admin.ts",
          side: "RIGHT",
        },
      ],
      event: "COMMENT",
      ref: { owner: "acme", repo: "widgets", number: 42 },
    });

    expect(result).toEqual({
      ok: true,
      data: {
        body: "Found one high-confidence issue.",
        htmlUrl: "https://github.com/acme/widgets/pull/42#pullrequestreview-9",
        id: 9,
        state: "COMMENTED",
      },
    });
    expect(octokit.rest.pulls.createReview).toHaveBeenCalledWith({
      body: "Found one high-confidence issue.",
      comments: [
        {
          body: "This can skip authorization for admin routes.",
          line: 27,
          path: "src/routes/admin.ts",
          side: "RIGHT",
        },
      ],
      event: "COMMENT",
      owner: "acme",
      pull_number: 42,
      repo: "widgets",
    });
  });

  it("returns structured validation errors without calling GitHub", async () => {
    const octokit = createMockOctokit();
    const client = createGitHubClient({ octokit });

    const result = await client.getPullRequestMetadata({
      owner: "",
      repo: "widgets",
      number: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.status).toBeUndefined();
    }
    expect(octokit.rest.pulls.get).not.toHaveBeenCalled();
  });

  it("returns structured GitHub API failures without exposing sensitive input", async () => {
    const octokit = createMockOctokit();
    octokit.request.mockRejectedValue({
      message: "Bad credentials",
      request: { headers: { authorization: "token ghp_secret" } },
      status: 401,
    });

    const client = createGitHubClient({ octokit });
    const result = await client.fetchPullRequestDiff({
      owner: "acme",
      repo: "widgets",
      number: 42,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: "unauthorized",
        message: "GitHub request failed with status 401.",
        status: 401,
      });
      expect(JSON.stringify(result.error)).not.toContain("ghp_secret");
    }
  });
});
