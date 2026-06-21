import {
  OPENAI_API_KEY_MISSING_WARNING,
  createOpenAIProvider,
  parseReviewPasses,
  reviewDiffWithLlm,
  type LlmProvider,
  type ReviewPromptTemplateId,
} from "@diffguard/llm";
import type { LlmReviewer, ReviewResult } from "@diffguard/reviewer";

export type WorkerLlmReviewerSetup = {
  llmReviewer?: LlmReviewer;
  provider?: LlmProvider;
  warnings: string[];
};

export function createWorkerLlmReviewer(input: {
  apiKey?: string;
  createProvider?: (config: { apiKey: string; model?: string }) => LlmProvider;
  model?: string;
  reviewPasses?: string;
}): WorkerLlmReviewerSetup {
  if (input.apiKey === undefined || input.apiKey.trim() === "") {
    return {
      warnings: [OPENAI_API_KEY_MISSING_WARNING],
    };
  }

  const provider = (input.createProvider ?? createOpenAIProvider)({
    apiKey: input.apiKey,
    model: input.model,
  });

  return {
    llmReviewer: createReviewDiffLlmReviewer({
      model: input.model,
      passes: parseReviewPasses(input.reviewPasses),
      provider,
    }),
    provider,
    warnings: [],
  };
}

function createReviewDiffLlmReviewer(input: {
  model?: string;
  passes: ReviewPromptTemplateId[];
  provider: LlmProvider;
}): LlmReviewer {
  return async (context) => {
    const findings: ReviewResult["findings"] = [];
    const modelCalls: ReviewResult["modelCalls"] = [];
    const diff = context.diff;
    const promptContext = buildPromptContext(context);

    for (const templateId of input.passes) {
      const result = await reviewDiffWithLlm({
        context: promptContext,
        diff,
        ...(input.model === undefined ? {} : { model: input.model }),
        provider: input.provider,
        providerName: "openai",
        rules: context.rules.content,
        templateId,
      });

      findings.push(...result.findings);
      modelCalls.push(
        ...result.modelCalls.map((call) => ({
          ...call,
          templateId,
        })),
      );
    }

    return {
      findings,
      modelCalls,
    };
  };
}

function buildPromptContext(context: ReviewResult["context"]): string[] {
  return [
    `Pull request #${context.pullRequest.number}: ${context.pullRequest.title}`,
    `Base: ${context.pullRequest.baseRef} (${context.pullRequest.baseSha})`,
    `Head: ${context.pullRequest.headRef} (${context.pullRequest.headSha})`,
    `Changed files: ${context.files.map((file) => file.filename).join(", ") || "none"}`,
  ];
}
