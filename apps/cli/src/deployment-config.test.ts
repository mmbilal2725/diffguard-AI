import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("production Docker deployment configuration", () => {
  it("defines production images, compose services, healthchecks, and migration docs", async () => {
    const apiDockerfile = await readWorkspaceFile("apps/api/Dockerfile");
    const workerDockerfile = await readWorkspaceFile("apps/worker/Dockerfile");
    const webDockerfile = await readWorkspaceFile("apps/web/Dockerfile");
    const compose = await readWorkspaceFile("docker-compose.prod.yml");
    const docs = await readWorkspaceFile("docs/deployment.md");

    expect(apiDockerfile).toContain("FROM node:20");
    expect(apiDockerfile).toContain("corepack enable");
    expect(apiDockerfile).toContain("--filter @diffguard/api...");
    expect(apiDockerfile).toContain("NODE_ENV=production");
    expect(apiDockerfile).toContain("HEALTHCHECK");
    expect(apiDockerfile).toContain("/health");

    expect(workerDockerfile).toContain("FROM node:20");
    expect(workerDockerfile).toContain("corepack enable");
    expect(workerDockerfile).toContain("--filter @diffguard/worker...");
    expect(workerDockerfile).toContain("NODE_ENV=production");
    expect(workerDockerfile).toContain("HEALTHCHECK");
    expect(workerDockerfile).toContain("REDIS_URL");

    expect(webDockerfile).toContain("FROM node:20");
    expect(webDockerfile).toContain("corepack enable");
    expect(webDockerfile).toContain("--filter @diffguard/web...");
    expect(webDockerfile).toContain("pnpm --filter @diffguard/web build");
    expect(webDockerfile).toContain("NODE_ENV=production");
    expect(webDockerfile).toContain("HEALTHCHECK");

    expect(compose).toContain("postgres:");
    expect(compose).toContain("redis:");
    expect(compose).toContain("api:");
    expect(compose).toContain("worker:");
    expect(compose).toContain("web:");
    expect(compose).toContain("postgres:16-alpine");
    expect(compose).toContain("redis:7-alpine");
    expect(compose).toContain("DATABASE_URL");
    expect(compose).toContain("REDIS_URL");
    expect(compose).toContain("${POSTGRES_PASSWORD");
    expect(compose).toContain("healthcheck:");

    expect(docs).toContain(
      "docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build",
    );
    expect(docs).toContain("prisma migrate deploy");
    expect(docs).toContain("DATABASE_URL");
    expect(docs).toContain("OPENAI_API_KEY");

    const combined = [apiDockerfile, workerDockerfile, webDockerfile, compose, docs].join("\n");
    expect(combined).not.toMatch(/sk-[A-Za-z0-9_-]{12,}/);
    expect(compose).not.toContain("POSTGRES_PASSWORD: diffguard");
    expect(compose).not.toMatch(/OPENAI_API_KEY:\s+sk-/);
    expect(compose).not.toMatch(/GITHUB_APP_PRIVATE_KEY:\s+-----BEGIN/);
  });
});

async function readWorkspaceFile(path: string): Promise<string> {
  return readFile(join(workspaceRoot, path), "utf8");
}
