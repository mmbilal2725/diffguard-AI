import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("versioned release and GitHub Action configuration", () => {
  it("runs the composite action correctly from a version tag", async () => {
    const action = await readWorkspaceFile("action.yml");
    const readme = await readWorkspaceFile("README.md");
    const docs = await readWorkspaceFile("docs/github-action.md");
    const example = await readWorkspaceFile("docs/examples/diffguard-ai-review.yml");

    expect(action).toContain("using: composite");
    expect(action).toContain("actions/setup-node@v4");
    expect(action).toContain("node-version: 20");
    expect(action).toContain("pnpm install --frozen-lockfile --dir \"$GITHUB_ACTION_PATH\"");
    expect(action).toContain("pnpm --dir \"$GITHUB_ACTION_PATH\" --filter @diffguard/cli");
    expect(action).toContain("GITHUB_TOKEN: ${{ inputs.github-token || github.token }}");
    expect(action).toContain("OPENAI_API_KEY: ${{ env.OPENAI_API_KEY }}");
    expect(action).toContain("DIFFGUARD_INPUT_REVIEW_PASSES");
    expect(action).toContain("--review-passes");

    for (const content of [readme, docs, example]) {
      expect(content).toContain("uses: diffguard-ai/diffguard-ai@v0.1.0");
    }

    expect(docs).toContain("permissions:");
    expect(docs).toContain("contents: read");
    expect(docs).toContain("pull-requests: write");
    expect(docs).toContain("OPENAI_API_KEY");
    expect(docs).toContain("GITHUB_TOKEN");
    expect(docs).toContain("Local Development");
    expect(docs).toContain("Troubleshooting");
  });

  it("defines a release workflow that runs CI before tagging and release notes", async () => {
    const ci = await readWorkspaceFile(".github/workflows/ci.yml");
    const release = await readWorkspaceFile(".github/workflows/release.yml");

    expect(ci).toContain("workflow_call:");
    expect(release).toContain("workflow_dispatch:");
    expect(release).toContain("version:");
    expect(release).toContain("uses: ./.github/workflows/ci.yml");
    expect(release).toContain("needs: ci");
    expect(release).toContain("pnpm install --frozen-lockfile");
    expect(release).toContain("pnpm prisma:generate");
    expect(release).toContain("pnpm build");
    expect(release).toContain("git tag \"$VERSION\"");
    expect(release).toContain("git push origin \"$VERSION\"");
    expect(release).toContain("gh release create \"$VERSION\"");
    expect(release).toContain("--generate-notes");
    expect(release).not.toContain("npm publish");
  });
});

async function readWorkspaceFile(path: string): Promise<string> {
  return readFile(join(workspaceRoot, path), "utf8");
}
