#!/usr/bin/env node
import { parseEvalCommandOptions, runEvalCommand } from "./eval-command.js";
import { parseReviewCommandOptions, runReviewCommand } from "./review-command.js";

async function main(): Promise<void> {
  const argv = normalizeCliArgv(process.argv.slice(2));
  const command = argv[0];
  const result =
    command === "eval"
      ? await runEvalCommand(parseEvalCommandOptions(argv))
      : await runReviewCommand(parseReviewCommandOptions(argv));

  process.stdout.write(`${result.output}\n`);

  if ("exitCode" in result) {
    process.exitCode = result.exitCode;
  }
}

function normalizeCliArgv(argv: string[]): string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown DiffGuard-AI CLI error.";

  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
