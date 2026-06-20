import type {
  FindingResolutionResult,
  ResolutionMetrics,
  ResolutionStatus,
  StoredPostedFinding,
} from "@diffguard/reviewer";

import type { ResolutionStore } from "./review-processor.js";

type PrismaFindingRecord = {
  category: string;
  confidence: number | { toString(): string };
  evidence: string;
  filePath: string;
  githubCommentId: string | null;
  id: string;
  line: number;
  severity: string;
  side: "LEFT" | "RIGHT";
  summary: string;
  suggestedFix: string | null;
  title: string;
  whyItMatters: string;
};

type PrismaResolutionClient = {
  finding: {
    findMany(input: {
      select: Record<keyof PrismaFindingRecord, true>;
      where: {
        githubCommentId: {
          not: null;
        };
        reviewRun: {
          pullRequest: {
            number: number;
            repository: {
              name: string;
              owner: string;
            };
          };
        };
      };
    }): Promise<PrismaFindingRecord[]>;
    update(input: {
      data: {
        status: string;
      };
      where: {
        id: string;
      };
    }): Promise<unknown>;
  };
  reviewRun: {
    update(input: {
      data: {
        estimatedFalsePositives: number;
        resolvedFindings: number;
      };
      where: {
        id: string;
      };
    }): Promise<unknown>;
  };
};

export function createPrismaResolutionStore(database: PrismaResolutionClient): ResolutionStore {
  return {
    async listPostedFindings(input) {
      const records = await database.finding.findMany({
        select: {
          category: true,
          confidence: true,
          evidence: true,
          filePath: true,
          githubCommentId: true,
          id: true,
          line: true,
          severity: true,
          side: true,
          summary: true,
          suggestedFix: true,
          title: true,
          whyItMatters: true,
        },
        where: {
          githubCommentId: {
            not: null,
          },
          reviewRun: {
            pullRequest: {
              number: input.pullNumber,
              repository: {
                name: input.repo,
                owner: input.owner,
              },
            },
          },
        },
      });

      return records.flatMap(toStoredPostedFinding);
    },

    async saveResolutionResults(input) {
      for (const result of input.results) {
        await database.finding.update({
          data: { status: toPrismaFindingStatus(result.status) },
          where: { id: result.findingId },
        });
      }

      await database.reviewRun.update({
        data: {
          estimatedFalsePositives: input.metrics.falsePositiveFindings,
          resolvedFindings: input.metrics.resolvedFindings,
        },
        where: { id: input.reviewRunId },
      });
    },
  };
}

export type SaveResolutionResultsInput = {
  metrics: ResolutionMetrics;
  results: FindingResolutionResult[];
  reviewRunId: string;
};

function toStoredPostedFinding(record: PrismaFindingRecord): StoredPostedFinding[] {
  if (record.githubCommentId === null) {
    return [];
  }

  return [
    {
      category: toSharedEnumValue(record.category),
      confidence: Number(record.confidence),
      evidence: record.evidence,
      filePath: record.filePath,
      githubCommentId: record.githubCommentId,
      id: record.id,
      line: record.line,
      severity: toSharedEnumValue(record.severity) as StoredPostedFinding["severity"],
      side: record.side,
      summary: record.summary,
      ...(record.suggestedFix === null ? {} : { suggestedFix: record.suggestedFix }),
      title: record.title,
      whyItMatters: record.whyItMatters,
    },
  ];
}

function toSharedEnumValue(value: string): StoredPostedFinding["category"] {
  return value.toLowerCase().replace(/_/g, "-") as StoredPostedFinding["category"];
}

function toPrismaFindingStatus(status: ResolutionStatus): string {
  switch (status) {
    case "resolved":
      return "RESOLVED";
    case "unresolved":
      return "UNRESOLVED";
    case "false_positive":
      return "FALSE_POSITIVE";
    case "unknown":
      return "UNKNOWN";
  }
}
