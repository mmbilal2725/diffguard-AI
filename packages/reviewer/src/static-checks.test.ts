import { describe, expect, it } from "vitest";

import type { PullRequestFile, PullRequestMetadata } from "@diffguard/github";

import { buildReviewContext, runDefaultStaticChecks } from "./index.js";

const pullRequest: PullRequestMetadata = {
  additions: 5,
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
  title: "Static checks",
};

describe("runDefaultStaticChecks", () => {
  it("flags accidental secrets in added diff lines without echoing the secret value", async () => {
    const findings = await runDefaultStaticChecks(
      createContext([
        createFile({
          filename: "src/config.ts",
          patch: '@@ -1,2 +1,3 @@\n export const ok = true;\n+const OPENAI_API_KEY = "sk_live_1234567890abcdef";',
        }),
      ]),
    );

    expect(findings).toEqual([
      expect.objectContaining({
        category: "security",
        filePath: "src/config.ts",
        line: 2,
        title: "Possible secret committed in diff",
      }),
    ]);
    expect(JSON.stringify(findings)).not.toContain("sk_live_1234567890abcdef");
  });

  it("flags logging of sensitive token-like values", async () => {
    const findings = await runDefaultStaticChecks(
      createContext([
        createFile({
          filename: "src/session.ts",
          patch: '@@ -10,2 +10,3 @@\n const token = session.token;\n+console.log("session token", token);',
        }),
      ]),
    );

    expect(findings).toEqual([
      expect.objectContaining({
        category: "security",
        filePath: "src/session.ts",
        line: 11,
        title: "Sensitive value is logged",
      }),
    ]);
  });

  it("flags admin routes that add handlers without an obvious auth guard from repository rules", async () => {
    const findings = await runDefaultStaticChecks(
      createContext(
        [
          createFile({
            filename: "src/routes/admin.ts",
            patch: '@@ -20,2 +20,4 @@\n export const router = createRouter();\n+router.get("/admin/users", async (req, res) => {\n+  return res.json(await listUsers());',
          }),
        ],
        "All admin routes must call requireAdmin().",
      ),
    );

    expect(findings).toEqual([
      expect.objectContaining({
        category: "authorization",
        filePath: "src/routes/admin.ts",
        line: 21,
        relatedRuleIds: [".diffguard-rules.md"],
        title: "Admin route appears to miss an auth guard",
      }),
    ]);
  });

  it("does not flag admin routes when the patch includes an obvious guard", async () => {
    const findings = await runDefaultStaticChecks(
      createContext(
        [
          createFile({
            filename: "src/routes/admin.ts",
            patch: '@@ -20,2 +20,5 @@\n export const router = createRouter();\n+router.get("/admin/users", async (req, res) => {\n+  requireAdmin(req.user);\n+  return res.json(await listUsers());',
          }),
          createFile({
            filename: "src/routes/admin.test.ts",
            patch: '@@ -1,1 +1,2 @@\n+it("requires admins", () => undefined);',
          }),
        ],
        "All admin routes must call requireAdmin().",
      ),
    );

    expect(findings).toEqual([]);
  });

  it("flags destructive database migration keywords", async () => {
    const findings = await runDefaultStaticChecks(
      createContext([
        createFile({
          filename: "packages/database/prisma/migrations/202606210001/drop_legacy.sql",
          patch: "@@ -1,1 +1,2 @@\n+ALTER TABLE users DROP COLUMN password_hash;",
        }),
      ]),
    );

    expect(findings).toEqual([
      expect.objectContaining({
        category: "data-loss",
        filePath: "packages/database/prisma/migrations/202606210001/drop_legacy.sql",
        title: "Destructive database migration keyword",
      }),
    ]);
  });

  it("flags hardcoded production URLs or credentials", async () => {
    const findings = await runDefaultStaticChecks(
      createContext([
        createFile({
          filename: "src/client.ts",
          patch: '@@ -1,1 +1,2 @@\n+export const API_BASE_URL = "https://api.retail.example.com";',
        }),
      ]),
    );

    expect(findings).toEqual([
      expect.objectContaining({
        category: "security",
        filePath: "src/client.ts",
        title: "Hardcoded production URL or credential",
      }),
    ]);
  });

  it("flags missing tests when critical files change and no test files are updated", async () => {
    const findings = await runDefaultStaticChecks(
      createContext([
        createFile({
          filename: "src/payments/charge.ts",
          patch: "@@ -30,2 +30,3 @@\n const amount = input.amount;\n+return chargeCard(amount);",
        }),
      ]),
    );

    expect(findings).toEqual([
      expect.objectContaining({
        category: "testing",
        filePath: "src/payments/charge.ts",
        title: "Critical file changed without tests",
      }),
    ]);
  });

  it("does not flag missing tests when a test file changes in the same pull request", async () => {
    const findings = await runDefaultStaticChecks(
      createContext([
        createFile({
          filename: "src/payments/charge.ts",
          patch: "@@ -30,2 +30,3 @@\n const amount = input.amount;\n+return chargeCard(amount);",
        }),
        createFile({
          filename: "src/payments/charge.test.ts",
          patch: '@@ -1,1 +1,2 @@\n+it("charges cards", () => undefined);',
        }),
      ]),
    );

    expect(findings).toEqual([]);
  });
});

function createContext(files: PullRequestFile[], rules: string | null = null) {
  return buildReviewContext({
    diff: files.map((file) => file.patch ?? "").join("\n\n"),
    dryRun: true,
    files,
    owner: "acme",
    pullNumber: 42,
    pullRequest,
    repo: "widgets",
    rules,
  });
}

function createFile(input: Pick<PullRequestFile, "filename" | "patch">): PullRequestFile {
  return {
    additions: 1,
    changes: 1,
    deletions: 0,
    filename: input.filename,
    patch: input.patch,
    sha: "file-sha",
    status: "modified",
  };
}
