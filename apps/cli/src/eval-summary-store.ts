import type { EvalReport } from "@diffguard/evals";

export type StoreEvalSummaryInput = {
  report: EvalReport;
  runName: string;
};

export type StoreEvalSummary = (input: StoreEvalSummaryInput) => Promise<void>;

type EvalRunDatabaseClient = {
  evalRun: {
    create(args: {
      data: {
        caseCount: number;
        costUsd: number;
        falseNegativeCount: number;
        falsePositiveCount: number;
        findingsPerPr: number;
        latencyMs: number;
        modelVersion: string;
        name: string;
        passed: boolean;
        precision: number;
        promptVersion: string;
        recall: number;
        truePositiveCount: number;
        validatorRejectionRate: number;
      };
    }): Promise<unknown>;
  };
};

export function createPrismaEvalSummaryStore(database: EvalRunDatabaseClient): StoreEvalSummary {
  return async ({ report, runName }) => {
    await database.evalRun.create({
      data: {
        caseCount: report.summary.caseCount,
        costUsd: report.summary.costUsd,
        falseNegativeCount: report.summary.falseNegativeCount,
        falsePositiveCount: report.summary.falsePositiveCount,
        findingsPerPr: report.summary.findingsPerPr,
        latencyMs: report.summary.latencyMs,
        modelVersion: report.summary.modelVersion,
        name: runName,
        passed: report.passed,
        precision: report.summary.precision,
        promptVersion: report.summary.promptVersion,
        recall: report.summary.recall,
        truePositiveCount: report.summary.truePositiveCount,
        validatorRejectionRate: report.summary.validatorRejectionRate,
      },
    });
  };
}

export async function createDefaultEvalSummaryStore(): Promise<StoreEvalSummary> {
  const { createDatabaseClient } = await import("@diffguard/database");
  return createPrismaEvalSummaryStore(createDatabaseClient() as unknown as EvalRunDatabaseClient);
}
