import { z } from "zod";

export const FindingSeveritySchema = z.enum(["low", "medium", "high", "critical"]);

export const FindingCategorySchema = z.enum([
  "logic_bug",
  "security_vulnerability",
  "broken_api_contract",
  "missing_authorization",
  "unsafe_database_change",
  "missing_error_handling",
  "regression_risk",
  "performance_problem",
  "missing_test"
]);

export const FindingLocationSchema = z
  .object({
    path: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive().optional()
  })
  .refine((location) => location.endLine === undefined || location.endLine >= location.startLine, {
    message: "endLine must be greater than or equal to startLine",
    path: ["endLine"]
  });

export const ReviewFindingSchema = z.object({
  title: z.string().min(8).max(160),
  body: z.string().min(20).max(4000),
  category: FindingCategorySchema,
  severity: FindingSeveritySchema,
  confidence: z.number().min(0.7).max(1),
  location: FindingLocationSchema,
  suggestedFix: z.string().min(1).max(2000).optional(),
  ruleIds: z.array(z.string().min(1)).default([])
});

export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export type FindingCategory = z.infer<typeof FindingCategorySchema>;
export type FindingLocation = z.infer<typeof FindingLocationSchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
