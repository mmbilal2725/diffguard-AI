import { describe, expect, it, vi } from "vitest";

import type { EvalCase, EvalReport } from "@diffguard/evals";

import {
  parseEvalCommandOptions,
  runEvalCommand,
  type EvalCommandDependencies,
} from "./eval-command.js";

describe("eval command", () => {
  it("parses eval run options from argv", () => {
    const options = parseEvalCommandOptions([
      "eval",
      "run",
      "--cases",
      "cases.json",
      "--model",
      "gpt-5.5",
      "--prompt-version",
      "review-v2",
      "--output",
      "json",
      "--fail-on-regression",
    ]);

    expect(options).toEqual({
      cases: "cases.json",
      failOnRegression: true,
      model: "gpt-5.5",
      output: "json",
      promptVersion: "review-v2",
    });
  });

  it("accepts the npm script separator before eval run", () => {
    const options = parseEvalCommandOptions([
      "--",
      "eval",
      "run",
      "--model",
      "gpt-5.5",
      "--prompt-version",
      "review-v2",
    ]);

    expect(options).toMatchObject({
      model: "gpt-5.5",
      promptVersion: "review-v2",
    });
  });

  it("runs eval cases and formats the requested report", async () => {
    const evalCases = [createEvalCase("case-one")];
    const calls: unknown[] = [];
    const dependencies: EvalCommandDependencies = {
      formatEvalReport: (report, output) => `format=${output};passed=${String(report.passed)}`,
      readFile: async () => JSON.stringify(evalCases),
      runEvalSuite: async (input) => {
        calls.push(input);

        return createEvalReport({ passed: true });
      },
    };

    const result = await runEvalCommand(
      {
        cases: "cases.json",
        failOnRegression: false,
        model: "gpt-5.5",
        output: "markdown",
        promptVersion: "review-v2",
      },
      dependencies,
    );

    expect(calls).toEqual([
      {
        cases: evalCases,
        modelVersion: "gpt-5.5",
        promptVersion: "review-v2",
      },
    ]);
    expect(result.output).toBe("format=markdown;passed=true");
    expect(result.exitCode).toBe(0);
  });

  it("loads eval cases from a JSON object with a cases array", async () => {
    const evalCases = [createEvalCase("case-one")];
    const calls: unknown[] = [];

    await runEvalCommand(
      {
        cases: "cases.json",
        failOnRegression: false,
        model: "gpt-5.5",
        output: "markdown",
        promptVersion: "review-v2",
      },
      {
        formatEvalReport: () => "",
        readFile: async () => JSON.stringify({ cases: evalCases }),
        runEvalSuite: async (input) => {
          calls.push(input);

          return createEvalReport({ passed: true });
        },
      },
    );

    expect(calls).toEqual([
      {
        cases: evalCases,
        modelVersion: "gpt-5.5",
        promptVersion: "review-v2",
      },
    ]);
  });

  it("does not fail a regression run unless fail-on-regression is requested", async () => {
    const result = await runEvalCommand(
      {
        failOnRegression: false,
        model: "gpt-5.5",
        output: "json",
        promptVersion: "review-v2",
      },
      {
        formatEvalReport: () => "{}",
        runEvalSuite: async () => createEvalReport({ passed: false }),
      },
    );

    expect(result.output).toBe("{}");
    expect(result.exitCode).toBe(0);
  });

  it("sets a non-zero exit code for regressions when requested", async () => {
    const result = await runEvalCommand(
      {
        failOnRegression: true,
        model: "gpt-5.5",
        output: "json",
        promptVersion: "review-v2",
      },
      {
        formatEvalReport: () => "{}",
        runEvalSuite: async () => createEvalReport({ passed: false }),
      },
    );

    expect(result.output).toBe("{}");
    expect(result.exitCode).toBe(1);
  });

  it("stores an eval run summary when persistence is configured", async () => {
    const storeEvalSummary = vi.fn(async () => undefined);
    const report = createEvalReport({ passed: true });

    await runEvalCommand(
      {
        failOnRegression: false,
        model: "gpt-5.5",
        output: "json",
        promptVersion: "review-v2",
      },
      {
        formatEvalReport: () => "{}",
        runEvalSuite: async () => report,
        storeEvalSummary,
      },
    );

    expect(storeEvalSummary).toHaveBeenCalledWith({
      report,
      runName: "review-v2 / gpt-5.5",
    });
  });
});

function createEvalCase(id: string): EvalCase {
  return {
    category: "authorization",
    diff: "diff --git a/src/admin.ts b/src/admin.ts\n+export const value = 1;",
    expectedFindings: [
      {
        category: "authorization",
        filePath: "src/admin.ts",
        line: 1,
        severity: "high",
        title: "Expected authorization bug",
        titleKeywords: ["authorization"],
      },
    ],
    id,
    language: "typescript",
    notes: "Test case loaded from a JSON file.",
    repoRules: "Only comment when confidence is high.",
    severity: "high",
    shouldNotMention: [],
    title: "Test eval case",
  };
}

function createEvalReport(input: { passed: boolean }): EvalReport {
  return {
    caseResults: [],
    falseNegatives: [],
    falsePositives: [],
    passed: input.passed,
    summary: {
      caseCount: 1,
      costUsd: 0,
      falseNegativeCount: input.passed ? 0 : 1,
      falsePositiveCount: 0,
      findingsPerPr: 0,
      latencyMs: 0,
      modelVersion: "gpt-5.5",
      precision: input.passed ? 1 : 0,
      promptVersion: "review-v2",
      recall: input.passed ? 1 : 0,
      truePositiveCount: input.passed ? 1 : 0,
      validatorRejectionRate: 0,
    },
  };
}
