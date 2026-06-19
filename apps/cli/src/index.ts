#!/usr/bin/env node
import { parseReviewCommandOptions, runReviewCommand } from "./review-command.js";

async function main(): Promise<void> {
  const options = parseReviewCommandOptions(process.argv.slice(2));
  const result = await runReviewCommand(options);

  process.stdout.write(`${result.output}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown DiffGuard-AI CLI error.";

  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
