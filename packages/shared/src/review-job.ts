import { z } from "zod";

export const REVIEW_QUEUE_JOB_NAME = "review-pr";

export const ReviewTriggerSchema = z.enum([
  "pull_request.opened",
  "pull_request.reopened",
  "pull_request.synchronize",
  "issue_comment.diffguard_review",
]);

export const ReviewJobDataSchema = z.object({
  deliveryId: z.string().min(1),
  headSha: z.string().min(1).optional(),
  installationId: z.string().min(1),
  owner: z.string().min(1),
  pullNumber: z.number().int().positive(),
  repo: z.string().min(1),
  reviewRunId: z.string().min(1),
  trigger: ReviewTriggerSchema,
});

export type ReviewTrigger = z.infer<typeof ReviewTriggerSchema>;
export type ReviewJobData = z.infer<typeof ReviewJobDataSchema>;
