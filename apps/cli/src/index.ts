#!/usr/bin/env node
import { createJsonLogger, toErrorLogFields } from "@diffguard/shared";

import { parseEvalCommandOptions, runEvalCommand } from "./eval-command.js";
import { formatCliError, parseReviewCommandOptions, runReviewCommand } from "./review-command.js";

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
  createJsonLogger({
    service: "diffguard-cli",
    sink: (line) => process.stderr.write(`${line}\n`),
  }).error(
    {
      ...toErrorLogFields(error),
      status: "failed",
    },
    "cli.command.failed",
  );
  process.stderr.write(`${formatCliError(error)}\n`);
  process.exitCode = 1;
});
