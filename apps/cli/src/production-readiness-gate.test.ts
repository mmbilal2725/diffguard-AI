import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

const requiredChecklistItems = [
  "build passes",
  "lint passes",
  "typecheck passes",
  "tests pass",
  "eval suite passes",
  "Docker images build",
  "database migrations apply cleanly",
  "GitHub webhook signature verification works",
  "duplicate webhooks are ignored",
  "worker processes PR jobs successfully",
  "comments are posted to GitHub",
  "dashboard shows real review data",
  "dashboard auth works",
  "secrets are not logged",
  "rate limiting works",
  "healthchecks pass",
  "release tag exists",
  "deployment docs are complete",
];

describe("production readiness gate", () => {
  it("documents the final gate and exposes a local production:check script", async () => {
    const checklist = await readWorkspaceFile("docs/production-readiness-checklist.md");
    const readme = await readWorkspaceFile("README.md");
    const productionCheckScript = await readWorkspaceFile("scripts/production-check.mjs");
    const productionEvalCases = await readWorkspaceFile("packages/evals/cases/production-check.json");
    const rootPackageJson = JSON.parse(await readWorkspaceFile("package.json")) as {
      scripts?: Record<string, string>;
    };

    for (const item of requiredChecklistItems) {
      expect(checklist).toContain(item);
    }

    expect(checklist).toContain("pnpm production:check");
    expect(checklist).toContain("Manual production checks");
    expect(checklist).toContain("Automated local gate");
    expect(readme).toContain("## Production Readiness");
    expect(readme).toContain("docs/production-readiness-checklist.md");
    expect(rootPackageJson.scripts?.["production:check"]).toBe(
      "node scripts/production-check.mjs",
    );

    expect(productionCheckScript).toContain("pnpm lint");
    expect(productionCheckScript).toContain("pnpm typecheck");
    expect(productionCheckScript).toContain("pnpm test");
    expect(productionCheckScript).toContain("pnpm build");
    expect(productionCheckScript).toContain("eval run");
    expect(productionCheckScript).toContain("../../packages/evals/cases/production-check.json");
    expect(productionCheckScript).toContain("--fail-on-regression");
    expect(productionCheckScript).toContain("docker compose -f docker-compose.prod.yml build");
    expect(productionCheckScript).toContain("prisma migrate deploy");
    expect(productionCheckScript).toContain("cmd.exe");
    expect(productionCheckScript).toContain("quoteWindowsArg");
    expect(productionCheckScript).not.toContain("OPENAI_API_KEY=");

    expect(productionEvalCases).toContain("production-check-false-positive-trap");
    expect(productionEvalCases).toContain('"expectedFindings": []');
  });
});

async function readWorkspaceFile(path: string): Promise<string> {
  return readFile(join(workspaceRoot, path), "utf8");
}
