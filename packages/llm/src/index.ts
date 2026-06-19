import { ReviewFindingSchema } from "@diffguard/shared";

export const REVIEW_PROMPT_VERSION = "review-v1";
export const VALIDATOR_PROMPT_VERSION = "validator-v1";
export const ReviewFindingOutputSchema = ReviewFindingSchema;

export type ReviewPromptInput = {
  diff: string;
  rules: string;
  context: string[];
};

export function createReviewPromptInput(input: ReviewPromptInput): ReviewPromptInput {
  return {
    diff: input.diff,
    rules: input.rules,
    context: [...input.context]
  };
}
