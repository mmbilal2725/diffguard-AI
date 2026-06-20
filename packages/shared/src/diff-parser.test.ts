import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "./diff-parser.js";

describe("parseUnifiedDiff", () => {
  it("parses files, hunks, and changed line numbers from a unified diff", () => {
    const parsed = parseUnifiedDiff(
      [
        "diff --git a/src/admin.ts b/src/admin.ts",
        "index 1111111..2222222 100644",
        "--- a/src/admin.ts",
        "+++ b/src/admin.ts",
        "@@ -10,3 +10,4 @@ export async function loadAdmin() {",
        " const user = await currentUser();",
        "-requireAdmin(user);",
        "+// auth moved to caller",
        "+return db.customer.findMany();",
        " return user;",
      ].join("\n"),
    );

    expect(parsed.files).toEqual([
      {
        hunks: [
          {
            header: "@@ -10,3 +10,4 @@ export async function loadAdmin() {",
            lines: [
              {
                content: " const user = await currentUser();",
                kind: "context",
                newLine: 10,
                oldLine: 10,
              },
              {
                content: "-requireAdmin(user);",
                kind: "delete",
                oldLine: 11,
              },
              {
                content: "+// auth moved to caller",
                kind: "add",
                newLine: 11,
              },
              {
                content: "+return db.customer.findMany();",
                kind: "add",
                newLine: 12,
              },
              {
                content: " return user;",
                kind: "context",
                newLine: 13,
                oldLine: 12,
              },
            ],
            newStart: 10,
            oldStart: 10,
          },
        ],
        newPath: "src/admin.ts",
        oldPath: "src/admin.ts",
      },
    ]);
  });

  it("keeps old and new paths for renamed files", () => {
    const parsed = parseUnifiedDiff(
      [
        "diff --git a/src/old-name.ts b/src/new-name.ts",
        "similarity index 92%",
        "rename from src/old-name.ts",
        "rename to src/new-name.ts",
        "--- a/src/old-name.ts",
        "+++ b/src/new-name.ts",
        "@@ -1 +1 @@",
        "-export const name = 'old';",
        "+export const name = 'new';",
        "\\ No newline at end of file",
      ].join("\n"),
    );

    expect(parsed.files[0]).toMatchObject({
      newPath: "src/new-name.ts",
      oldPath: "src/old-name.ts",
    });
    expect(parsed.files[0]?.hunks[0]?.lines).toEqual([
      {
        content: "-export const name = 'old';",
        kind: "delete",
        oldLine: 1,
      },
      {
        content: "+export const name = 'new';",
        kind: "add",
        newLine: 1,
      },
    ]);
  });
});
