#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

const isWindows = process.platform === "win32";
const pnpmCommand = isWindows ? "pnpm.cmd" : "pnpm";
const artifactsDir = join("artifacts", "production-check");
const args = new Set(process.argv.slice(2));

const skipDocker = args.has("--skip-docker");
const skipMigrations = args.has("--skip-migrations");

const checks = [
  {
    name: "Prisma client generation",
    command: pnpmCommand,
    args: ["prisma:generate"],
    commandLine: "pnpm prisma:generate",
  },
  {
    name: "Lint",
    command: pnpmCommand,
    args: ["lint"],
    commandLine: "pnpm lint",
  },
  {
    name: "Typecheck",
    command: pnpmCommand,
    args: ["typecheck"],
    commandLine: "pnpm typecheck",
  },
  {
    name: "Tests",
    command: pnpmCommand,
    args: ["test"],
    commandLine: "pnpm test",
  },
  {
    name: "Build",
    command: pnpmCommand,
    args: ["build"],
    commandLine: "pnpm build",
  },
  {
    name: "Deterministic eval suite",
    command: pnpmCommand,
    args: [
      "--silent",
      "--filter",
      "@diffguard/cli",
      "start",
      "--",
      "eval",
      "run",
      "--cases",
      "../../packages/evals/cases/production-check.json",
      "--model",
      "production-check-mock",
      "--prompt-version",
      "production-check-mock",
      "--output",
      "json",
      "--fail-on-regression",
    ],
    commandLine:
      "pnpm --silent --filter @diffguard/cli start -- eval run --cases ../../packages/evals/cases/production-check.json --model production-check-mock --prompt-version production-check-mock --output json --fail-on-regression",
    outputFile: join(artifactsDir, "eval-report.json"),
  },
];

if (!skipDocker) {
  checks.push({
    name: "Production Docker images",
    command: "docker",
    args: ["compose", "-f", "docker-compose.prod.yml", "build"],
    commandLine: "docker compose -f docker-compose.prod.yml build",
  });
}

if (!skipMigrations && hasDatabaseUrl()) {
  checks.push({
    name: "Production database migrations",
    command: pnpmCommand,
    args: ["--filter", "@diffguard/database", "exec", "prisma", "migrate", "deploy"],
    commandLine: "pnpm --filter @diffguard/database exec prisma migrate deploy",
  });
}

if (!hasDatabaseUrl()) {
  console.log(
    "[production:check] DATABASE_URL is not set; skipping prisma migrate deploy. Run against a disposable or intended deployment database before release.",
  );
}

if (skipDocker) {
  console.log("[production:check] --skip-docker set; skipping production Docker image build.");
}

if (skipMigrations) {
  console.log("[production:check] --skip-migrations set; skipping prisma migrate deploy.");
}

mkdirSync(artifactsDir, { recursive: true });

for (const check of checks) {
  console.log(`\n[production:check] ${check.name}`);
  console.log(`[production:check] $ ${check.commandLine}`);
  await runCheck(check);
}

console.log("\n[production:check] Automated production readiness checks passed.");

function hasDatabaseUrl() {
  return typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim() !== "";
}

function runCheck(check) {
  return new Promise((resolve, reject) => {
    const stdio = check.outputFile === undefined ? "inherit" : ["inherit", "pipe", "inherit"];
    const childProcess = createChildProcessCommand(check);
    const child = spawn(childProcess.command, childProcess.args, {
      env: process.env,
      shell: false,
      stdio,
    });

    let output = "";
    if (check.outputFile !== undefined && child.stdout !== null) {
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
    }

    child.on("error", (error) => {
      reject(new Error(`${check.name} could not start: ${error.message}`));
    });

    child.on("close", async (code) => {
      if (check.outputFile !== undefined) {
        try {
          await writeFile(check.outputFile, output);
        } catch (error) {
          reject(
            new Error(
              `Could not write ${check.outputFile}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
          return;
        }
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${check.name} failed with exit code ${code ?? "unknown"}.`));
    });
  });
}

function createChildProcessCommand(check) {
  if (!isWindows) {
    return {
      args: check.args,
      command: check.command,
    };
  }

  return {
    args: ["/d", "/s", "/c", [check.command, ...check.args].map(quoteWindowsArg).join(" ")],
    command: "cmd.exe",
  };
}

function quoteWindowsArg(arg) {
  if (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}
