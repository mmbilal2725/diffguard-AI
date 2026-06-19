import { z } from "zod";

export const FindingSeveritySchema = z.enum(["low", "medium", "high", "critical"]);

export const FindingCategorySchema = z.enum([
  "logic",
  "security",
  "performance",
  "reliability",
  "regression",
  "testing",
  "data-loss",
  "api-contract",
  "authorization",
  "validation",
]);

export const ReviewFindingSideSchema = z.enum(["LEFT", "RIGHT"]);

export const ReviewFindingSchema = z
  .object({
    title: z.string().min(8).max(160),
    category: FindingCategorySchema,
    severity: FindingSeveritySchema,
    confidence: z.number().min(0.7).max(1),
    filePath: z.string().min(1),
    line: z.number().int().positive(),
    side: ReviewFindingSideSchema,
    summary: z.string().min(20).max(2000),
    evidence: z.string().min(20).max(3000),
    improvedComment: z.string().min(20).max(4000).optional(),
    suggestedFix: z.string().min(1).max(2000),
    whyItMatters: z.string().min(20).max(2000),
    relatedRuleIds: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export type FindingCategory = z.infer<typeof FindingCategorySchema>;
export type ReviewFindingSide = z.infer<typeof ReviewFindingSideSchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
