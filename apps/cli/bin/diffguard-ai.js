#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const entrypoint = join(dirname(fileURLToPath(import.meta.url)), "../src/index.ts");
const result = spawnSync(process.execPath, ["--import", "tsx", entrypoint, ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
