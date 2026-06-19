import {
  EvalCaseSchema,
  formatEvalReport,
  runEvalSuite,
  type EvalCase,
  type EvalOutputFormat,
  type EvalReport,
  type EvalSuiteInput,
} from "@diffguard/evals";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const DEFAULT_OUTPUT_FORMAT: EvalOutputFormat = "markdown";
const DEFAULT_MODEL_VERSION = "not-configured";
const DEFAULT_PROMPT_VERSION = "not-configured";

const EvalCommandOptionsSchema = z.object({
  cases: z.string().min(1).optional(),
  failOnRegression: z.boolean().default(false),
  model: z.string().min(1).default(DEFAULT_MODEL_VERSION),
  output: z.enum(["json", "markdown"]).default(DEFAULT_OUTPUT_FORMAT),
  promptVersion: z.string().min(1).default(DEFAULT_PROMPT_VERSION),
});

const EvalCasesFileSchema = z.union([
  z.array(EvalCaseSchema),
  z.object({ cases: z.array(EvalCaseSchema) }).strict(),
]);

export type EvalCommandOptions = z.infer<typeof EvalCommandOptionsSchema>;

export type EvalCommandResult = {
  exitCode: number;
  output: string;
  report: EvalReport;
};

export type EvalCommandDependencies = {
  formatEvalReport?: (report: EvalReport, output: EvalOutputFormat) => string;
  readFile?: (path: string) => Promise<string>;
  runEvalSuite?: (input: EvalSuiteInput) => Promise<EvalReport>;
};

type ParsedArgValue = boolean | string | undefined;

export function parseEvalCommandOptions(argv: string[]): EvalCommandOptions {
  const normalizedArgv = normalizeCliArgv(argv);
  const [command, subcommand, ...args] = normalizedArgv;
  if (command !== "eval" || subcommand !== "run") {
    throw new Error("Expected command: diffguard-ai eval run");
  }

  const parsed = parseArgs(args);

  return EvalCommandOptionsSchema.parse({
    cases: parsed.cases,
    failOnRegression: parsed["fail-on-regression"] ?? false,
    model: parsed.model,
    output: parsed.output,
    promptVersion: parsed["prompt-version"],
  });
}

export async function runEvalCommand(
  options: EvalCommandOptions,
  dependencies: EvalCommandDependencies = {},
): Promise<EvalCommandResult> {
  const cases =
    options.cases === undefined
      ? undefined
      : await loadEvalCases(options.cases, dependencies.readFile ?? readFileUtf8);
  const runner = dependencies.runEvalSuite ?? runEvalSuite;
  const report = await runner({
    ...(cases === undefined ? {} : { cases }),
    modelVersion: options.model,
    promptVersion: options.promptVersion,
  });
  const formatter = dependencies.formatEvalReport ?? formatEvalReport;

  return {
    exitCode: options.failOnRegression && !report.passed ? 1 : 0,
    output: formatter(report, options.output),
    report,
  };
}

function normalizeCliArgv(argv: string[]): string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

async function loadEvalCases(
  casesPath: string,
  readFileDependency: (path: string) => Promise<string>,
): Promise<EvalCase[]> {
  const raw = await readFileDependency(casesPath);
  const parsedJson = JSON.parse(raw) as unknown;
  const parsed = EvalCasesFileSchema.parse(parsedJson);

  return Array.isArray(parsed) ? parsed : parsed.cases;
}

async function readFileUtf8(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function parseArgs(args: string[]): Record<string, ParsedArgValue> {
  const parsed: Record<string, ParsedArgValue> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === undefined || !arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg ?? ""}`);
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (rawKey === undefined || rawKey === "") {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = rawKey;

    if (key === "fail-on-regression") {
      parsed[key] = inlineValue === undefined ? true : inlineValue === "true";
      continue;
    }

    const value = inlineValue ?? args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    parsed[key] = value;

    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return parsed;
}
