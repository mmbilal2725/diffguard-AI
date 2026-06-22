import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { createDatabaseClient } from "./index.js";

describe("createDatabaseClient", () => {
  it("creates a Prisma client without connecting to the database", () => {
    const client = createDatabaseClient();

    expect(client).toHaveProperty("$connect");
    expect(client).toHaveProperty("$disconnect");
  });

  it("defines production review-run persistence models and indexes", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");

    expect(schema).toContain("model Repository");
    expect(schema).toContain("model PullRequest");
    expect(schema).toContain("model ReviewRun");
    expect(schema).toContain("model Finding");
    expect(schema).toContain("model ValidatorDecision");
    expect(schema).toContain("model ModelCall");
    expect(schema).toContain("model WebhookDelivery");
    expect(schema).toContain("model EvalRun");
    expect(schema).toContain("SKIPPED");
    expect(schema).toContain("errorMessage");
    expect(schema).toContain("@@index([status, createdAt])");
    expect(schema).toContain("@@index([reviewRunId, decision])");
  });

  it("includes a migration for review-run production persistence fields", () => {
    const migrations = readdirSync("prisma/migrations", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        readFileSync(join("prisma/migrations", entry.name, "migration.sql"), "utf8"),
      )
      .join("\n");

    expect(migrations).toContain("ValidatorDecision");
    expect(migrations).toContain("SKIPPED");
    expect(migrations).toContain("errorMessage");
  });
});
