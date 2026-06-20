import type { PullRequestFile } from "@diffguard/github";
import {
  FindingCategorySchema,
  FindingSeveritySchema,
  ReviewFindingSideSchema,
  type FindingCategory,
  type FindingSeverity,
  type ReviewFindingSide,
} from "@diffguard/shared";
import { z } from "zod";

export const ResolutionStatusSchema = z.enum([
  "resolved",
  "unresolved",
  "false_positive",
  "unknown",
]);

const ResolutionValidatorResultSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    reason: z.string().min(20).max(2000),
    status: ResolutionStatusSchema,
  })
  .passthrough();

export type ResolutionStatus = z.infer<typeof ResolutionStatusSchema>;

export type StoredPostedFinding = {
  category: FindingCategory;
  confidence: number;
  evidence: string;
  filePath: string;
  githubCommentId: string;
  id: string;
  line: number;
  severity: FindingSeverity;
  side: ReviewFindingSide;
  summary: string;
  suggestedFix?: string;
  title: string;
  whyItMatters: string;
};

export type ResolutionValidatorInput = {
  finding: StoredPostedFinding;
  latestCodeContext: string[];
  latestDiff: string;
};

export type ResolutionValidatorResult = z.infer<typeof ResolutionValidatorResultSchema>;

export type ResolutionValidator = (
  input: ResolutionValidatorInput,
) => Promise<unknown>;

export type FindingResolutionResult = ResolutionValidatorResult & {
  findingId: string;
};

export type ResolutionMetrics = {
  estimatedResolutionRate: number;
  falsePositiveFindings: number;
  postedFindings: number;
  resolvedFindings: number;
  unknownFindings: number;
  unresolvedFindings: number;
};

export async function trackFindingResolutions(input: {
  findings: StoredPostedFinding[];
  latestDiff: string;
  latestFiles: PullRequestFile[];
  validator: ResolutionValidator;
}): Promise<{ metrics: ResolutionMetrics; results: FindingResolutionResult[] }> {
  const results: FindingResolutionResult[] = [];

  for (const finding of input.findings.map(validateStoredPostedFinding)) {
    const latestCodeContext = buildLatestCodeContext(input.latestFiles, finding);

    if (latestCodeContext.length === 0 || input.latestDiff.trim().length === 0) {
      results.push({
        confidence: 0,
        findingId: finding.id,
        reason: "Latest diff/code evidence did not include the original finding location.",
        status: "unknown",
      });
      continue;
    }

    const rawResolution = await input.validator({
      finding,
      latestCodeContext,
      latestDiff: input.latestDiff,
    });
    const parsedResolution = ResolutionValidatorResultSchema.safeParse(rawResolution);

    if (!parsedResolution.success) {
      results.push({
        confidence: 0,
        findingId: finding.id,
        reason: "Resolution validator output did not match the required structured schema.",
        status: "unknown",
      });
      continue;
    }

    results.push({
      ...parsedResolution.data,
      findingId: finding.id,
    });
  }

  return {
    metrics: calculateResolutionMetrics(results),
    results,
  };
}

export function calculateResolutionMetrics(results: FindingResolutionResult[]): ResolutionMetrics {
  const postedFindings = results.length;
  const resolvedFindings = countStatus(results, "resolved");

  return {
    estimatedResolutionRate: postedFindings === 0 ? 0 : resolvedFindings / postedFindings,
    falsePositiveFindings: countStatus(results, "false_positive"),
    postedFindings,
    resolvedFindings,
    unknownFindings: countStatus(results, "unknown"),
    unresolvedFindings: countStatus(results, "unresolved"),
  };
}

function validateStoredPostedFinding(finding: StoredPostedFinding): StoredPostedFinding {
  const category = FindingCategorySchema.parse(finding.category);
  const severity = FindingSeveritySchema.parse(finding.severity);
  const side = ReviewFindingSideSchema.parse(finding.side);

  return {
    ...finding,
    category,
    severity,
    side,
  };
}

function buildLatestCodeContext(
  files: PullRequestFile[],
  finding: StoredPostedFinding,
): string[] {
  const file = files.find(
    (changedFile) =>
      changedFile.filename === finding.filePath || changedFile.previousFilename === finding.filePath,
  );

  if (file?.patch === undefined) {
    return [];
  }

  return [formatFileDiff(file)];
}

function formatFileDiff(file: PullRequestFile): string {
  return [`File: ${file.filename}`, "Patch:", file.patch].join("\n");
}

function countStatus(results: FindingResolutionResult[], status: ResolutionStatus): number {
  return results.filter((result) => result.status === status).length;
}
