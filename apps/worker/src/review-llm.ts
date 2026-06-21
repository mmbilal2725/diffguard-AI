import {
  OPENAI_API_KEY_MISSING_WARNING,
  createOpenAIProvider,
  parseReviewPasses,
  reviewDiffWithLlm,
  validateFindingWithLlm,
  type LlmProvider,
  type ReviewPromptTemplateId,
} from "@diffguard/llm";
import type { FindingValidator, LlmReviewer, ReviewResult } from "@diffguard/reviewer";

export type WorkerLlmReviewerSetup = {
  findingValidator?: FindingValidator;
  llmReviewer?: LlmReviewer;
  provider?: LlmProvider;
  warnings: string[];
};

export function createWorkerLlmReviewer(input: {
  apiKey?: string;
  createProvider?: (config: { apiKey: string; model?: string }) => LlmProvider;
  model?: string;
  reviewPasses?: string;
  validatorModel?: string;
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
    ...(input.validatorModel === undefined
      ? {}
      : {
          findingValidator: createFindingLlmValidator({
            model: input.validatorModel,
            provider,
          }),
        }),
    llmReviewer: createReviewDiffLlmReviewer({
      model: input.model,
      passes: parseReviewPasses(input.reviewPasses),
      provider,
    }),
    provider,
    warnings: [],
  };
}

function createFindingLlmValidator(input: {
  model: string;
  provider: LlmProvider;
}): FindingValidator {
  return async (validatorInput) => {
    const result = await validateFindingWithLlm({
      changedFilePatch: validatorInput.changedFilePatch,
      diff: validatorInput.diff,
      finding: validatorInput.finding,
      model: input.model,
      provider: input.provider,
      providerName: "openai",
      reviewerConfidence: validatorInput.reviewerConfidence,
      rules: validatorInput.rules,
      staticAnalysisContext: validatorInput.staticCheckResults,
    });

    return {
      confidence: result.confidence,
      falsePositiveRisk: result.falsePositiveRisk,
      ...(result.improvedComment === undefined ? {} : { improvedComment: result.improvedComment }),
      reason: result.reason,
      shouldPost: result.shouldPost,
      valid: result.valid,
    };
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
