import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("GitHub Actions CI workflow", () => {
  it("runs the production quality CI gate without requiring live OpenAI credentials", async () => {
    const workflow = await readWorkspaceFile(".github/workflows/ci.yml");
    const rootPackageJson = JSON.parse(await readWorkspaceFile("package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("actions/checkout");
    expect(workflow).toContain("actions/setup-node");
    expect(workflow).toContain("node-version: 20");
    expect(workflow).toContain("pnpm/action-setup");
    expect(workflow).toContain("cache: pnpm");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain("pnpm prisma:generate");
    expect(workflow).toContain("pnpm lint");
    expect(workflow).toContain("pnpm typecheck");
    expect(workflow).toContain("pnpm test");
    expect(workflow).toContain("pnpm build");
    expect(workflow).toContain("eval run");
    expect(workflow).toContain("pnpm --silent");
    expect(workflow).toContain("--output json");
    expect(workflow).toContain("eval-report.json");
    expect(workflow).toContain("actions/upload-artifact");
    expect(workflow).toContain("if-no-files-found: ignore");
    expect(workflow).toContain("OPENAI_API_KEY: \"\"");
    expect(workflow).toContain("DIFFGUARD_DEMO_MODE: \"true\"");

    expect(workflow).not.toContain("${{ secrets.OPENAI_API_KEY }}");
    expect(rootPackageJson.scripts?.build).toBeDefined();
  });
});

async function readWorkspaceFile(path: string): Promise<string> {
  return readFile(join(workspaceRoot, path), "utf8");
}
