import { describe, expect, it } from "vitest";

import { REVIEW_PROMPT_VERSION, createReviewPromptInput } from "./index.js";

describe("createReviewPromptInput", () => {
  it("keeps prompts versioned and includes repository rules", () => {
    const input = createReviewPromptInput({
      diff: "diff --git a/file.ts b/file.ts",
      rules: "Only comment when confidence is high.",
      context: ["src/file.ts"]
    });

    expect(REVIEW_PROMPT_VERSION).toBe("review-v1");
    expect(input.rules).toContain("confidence is high");
  });
});
