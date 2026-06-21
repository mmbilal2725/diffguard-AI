import OpenAI from "openai";
import { ReviewFindingSchema, type ReviewFinding } from "@diffguard/shared";
import { z } from "zod";

export const REVIEW_PROMPT_VERSION = "review-v1";
export const VALIDATOR_PROMPT_VERSION = "validator-v1";
export const RESOLUTION_VALIDATOR_PROMPT_VERSION = "resolution-validator-v1";
export const DEFAULT_OPENAI_REVIEW_MODEL = "gpt-5.5";

export const ReviewFindingOutputSchema = z
  .object({
    findings: z.array(ReviewFindingSchema).max(20),
  })
  .strict();

export const REVIEW_FINDING_JSON_SCHEMA = {
  additionalProperties: false,
  properties: {
    findings: {
      items: {
        additionalProperties: false,
        properties: {
          category: {
            enum: [
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
            ],
            type: "string",
          },
          confidence: {
            maximum: 1,
            minimum: 0.7,
            type: "number",
          },
          evidence: {
            maxLength: 3000,
            minLength: 20,
            type: "string",
          },
          filePath: {
            minLength: 1,
            type: "string",
          },
          line: {
            minimum: 1,
            type: "integer",
          },
          relatedRuleIds: {
            items: {
              minLength: 1,
              type: "string",
            },
            type: "array",
          },
          severity: {
            enum: ["low", "medium", "high", "critical"],
            type: "string",
          },
          side: {
            enum: ["LEFT", "RIGHT"],
            type: "string",
          },
          suggestedFix: {
            maxLength: 2000,
            minLength: 1,
            type: "string",
          },
          summary: {
            maxLength: 2000,
            minLength: 20,
            type: "string",
          },
          title: {
            maxLength: 160,
            minLength: 8,
            type: "string",
          },
          whyItMatters: {
            maxLength: 2000,
            minLength: 20,
            type: "string",
          },
        },
        required: [
          "title",
          "category",
          "severity",
          "confidence",
          "filePath",
          "line",
          "side",
          "summary",
          "evidence",
          "suggestedFix",
          "whyItMatters",
          "relatedRuleIds",
        ],
        type: "object",
      },
      maxItems: 20,
      type: "array",
    },
  },
  required: ["findings"],
  type: "object",
} as const;

export const FINDING_VALIDATION_JSON_SCHEMA = {
  additionalProperties: false,
  properties: {
    confidence: {
      maximum: 1,
      minimum: 0,
      type: "number",
    },
    falsePositiveRisk: {
      enum: ["low", "medium", "high"],
      type: "string",
    },
    improvedComment: {
      anyOf: [
        {
          maxLength: 4000,
          minLength: 20,
          type: "string",
        },
        {
          type: "null",
        },
      ],
    },
    reason: {
      maxLength: 2000,
      minLength: 20,
      type: "string",
    },
    shouldPost: {
      type: "boolean",
    },
    valid: {
      type: "boolean",
    },
  },
  required: [
    "valid",
    "shouldPost",
    "confidence",
    "falsePositiveRisk",
    "improvedComment",
    "reason",
  ],
  type: "object",
} as const;

export const RESOLUTION_STATUS_JSON_SCHEMA = {
  additionalProperties: false,
  properties: {
    confidence: {
      maximum: 1,
      minimum: 0,
      type: "number",
    },
    reason: {
      maxLength: 2000,
      minLength: 20,
      type: "string",
    },
    status: {
      enum: ["resolved", "unresolved", "false_positive", "unknown"],
      type: "string",
    },
  },
  required: ["status", "confidence", "reason"],
  type: "object",
} as const;

const ResolutionValidatorOutputSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    reason: z.string().min(20).max(2000),
    status: z.enum(["resolved", "unresolved", "false_positive", "unknown"]),
  })
  .strict();

const FindingValidatorOutputSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    falsePositiveRisk: z.enum(["low", "medium", "high"]),
    improvedComment: z.string().min(20).max(4000).nullable().optional(),
    reason: z.string().min(20).max(2000),
    shouldPost: z.boolean(),
    valid: z.boolean(),
  })
  .strict()
  .transform((output) => ({
    confidence: output.confidence,
    falsePositiveRisk: output.falsePositiveRisk,
    ...(output.improvedComment === null || output.improvedComment === undefined
      ? {}
      : { improvedComment: output.improvedComment }),
    reason: output.reason,
    shouldPost: output.shouldPost,
    valid: output.valid,
  }));

export type ReviewPromptInput = {
  context?: string[];
  diff: string;
  rules: string | null;
};

export function createReviewPromptInput(input: ReviewPromptInput): ReviewPromptInput {
  return {
    context: [...(input.context ?? [])],
    diff: input.diff,
    rules: input.rules,
  };
}

export type ReviewPromptTemplateId = "logic-bugs" | "security-bugs" | "regression-test-gaps";

export type LlmMessage = {
  content: string;
  role: "system" | "user";
};

export type ReviewPromptTemplate = {
  buildUserMessage(input: ReviewPromptInput): string;
  id: ReviewPromptTemplateId;
  system: string;
  version: typeof REVIEW_PROMPT_VERSION;
};

const BASE_SYSTEM_PROMPT = [
  "You are DiffGuard-AI, a low-noise pull request review agent.",
  "Return only structured JSON that matches the provided schema. Do not return markdown, prose, code fences, or unvalidated text.",
  "Only report high-confidence, actionable engineering bugs. Ignore style-only, formatting-only, naming, and vague refactoring suggestions.",
  "Every finding must cite diff evidence and a concrete changed line. Use side RIGHT for added/current lines and LEFT only for removed base-side lines.",
].join("\n");

export const REVIEW_PROMPT_TEMPLATES: Record<ReviewPromptTemplateId, ReviewPromptTemplate> = {
  "logic-bugs": {
    buildUserMessage: buildReviewUserMessage,
    id: "logic-bugs",
    system: `${BASE_SYSTEM_PROMPT}\nFocus on logic bugs, validation mistakes, reliability failures, API contract breakage, data-loss risks, and performance problems introduced by the diff.`,
    version: REVIEW_PROMPT_VERSION,
  },
  "security-bugs": {
    buildUserMessage: buildReviewUserMessage,
    id: "security-bugs",
    system: `${BASE_SYSTEM_PROMPT}\nFocus on security bugs: authorization bypasses, authentication mistakes, secret exposure, injection, unsafe validation, and sensitive data leaks.`,
    version: REVIEW_PROMPT_VERSION,
  },
  "regression-test-gaps": {
    buildUserMessage: buildReviewUserMessage,
    id: "regression-test-gaps",
    system: `${BASE_SYSTEM_PROMPT}\nFocus on regression risks and missing tests only when the diff changes behavior without coverage for a concrete failure mode.`,
    version: REVIEW_PROMPT_VERSION,
  },
};

export const DEFAULT_REVIEW_PASSES = [
  "logic-bugs",
  "security-bugs",
  "regression-test-gaps",
] as const satisfies readonly ReviewPromptTemplateId[];

export const OPENAI_API_KEY_MISSING_WARNING =
  "OPENAI_API_KEY is not configured; skipping LLM review safely.";

export function parseReviewPasses(value: string | undefined): ReviewPromptTemplateId[] {
  if (value === undefined || value.trim() === "") {
    return [...DEFAULT_REVIEW_PASSES];
  }

  const selected: ReviewPromptTemplateId[] = [];
  const seen = new Set<ReviewPromptTemplateId>();

  for (const rawPass of value.split(",")) {
    const pass = rawPass.trim();
    if (pass === "") {
      continue;
    }

    if (!isReviewPromptTemplateId(pass)) {
      throw new Error(
        `Invalid DIFFGUARD_REVIEW_PASSES value. Unsupported review pass: ${pass}. Supported passes: ${DEFAULT_REVIEW_PASSES.join(", ")}.`,
      );
    }

    if (!seen.has(pass)) {
      selected.push(pass);
      seen.add(pass);
    }
  }

  return selected.length > 0 ? selected : [...DEFAULT_REVIEW_PASSES];
}

function isReviewPromptTemplateId(value: string): value is ReviewPromptTemplateId {
  return Object.prototype.hasOwnProperty.call(REVIEW_PROMPT_TEMPLATES, value);
}

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type LlmProviderRequest = {
  messages: LlmMessage[];
  model: string;
  responseSchema:
    | typeof FINDING_VALIDATION_JSON_SCHEMA
    | typeof REVIEW_FINDING_JSON_SCHEMA
    | typeof RESOLUTION_STATUS_JSON_SCHEMA;
  responseSchemaName:
    | "diffguard_finding_validation"
    | "diffguard_review_findings"
    | "diffguard_resolution_status";
  temperature?: number;
};

export type LlmProviderResponse = {
  model: string;
  output: unknown;
  tokenUsage: TokenUsage;
};

export type LlmProvider = {
  generateJson(request: LlmProviderRequest): Promise<LlmProviderResponse>;
};

export type TokenPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type ModelCallStatus = "succeeded" | "invalid_output" | "failed";

export type ModelCallLog = {
  attempt: number;
  costUsd: number;
  latencyMs: number;
  model: string;
  promptVersion: string;
  provider: string;
  status: ModelCallStatus;
  tokenUsage: TokenUsage;
};

export type ReviewDiffWithLlmInput = ReviewPromptInput & {
  maxValidationRetries?: number;
  model?: string;
  onModelCall?: (call: ModelCallLog) => void;
  pricing?: TokenPricing;
  provider: LlmProvider;
  providerName?: string;
  templateId: ReviewPromptTemplateId;
};

export type ReviewDiffWithLlmResult = {
  findings: ReviewFinding[];
  modelCalls: ModelCallLog[];
  promptVersion: string;
};

export class LlmValidationError extends Error {
  readonly modelCalls: ModelCallLog[];
  readonly validationIssues: Array<{ message: string; path: string }>;

  constructor(
    validationIssues: Array<{ message: string; path: string }>,
    modelCalls: ModelCallLog[],
  ) {
    super("LLM structured output did not match the ReviewFinding schema.");
    this.name = "LlmValidationError";
    this.modelCalls = modelCalls;
    this.validationIssues = validationIssues;
  }
}

export class OpenAIProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIProviderError";
  }
}

export type OpenAIProviderConfig = {
  apiKey?: string;
  client?: OpenAICompatibleClient;
  model?: string;
};

type OpenAICompatibleClient = {
  chat: {
    completions: {
      create(request: OpenAIChatCompletionRequest): Promise<OpenAIChatCompletionResponse>;
    };
  };
};

type OpenAIChatCompletionRequest = {
  messages: LlmMessage[];
  model: string;
  response_format: {
    json_schema: {
      name: string;
      schema:
        | typeof FINDING_VALIDATION_JSON_SCHEMA
        | typeof REVIEW_FINDING_JSON_SCHEMA
        | typeof RESOLUTION_STATUS_JSON_SCHEMA;
      strict: true;
    };
    type: "json_schema";
  };
  temperature?: number;
};

type OpenAIChatCompletionResponse = {
  choices: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  model?: string;
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
};

export class OpenAIProvider implements LlmProvider {
  private readonly client: OpenAICompatibleClient;
  private readonly model: string;

  constructor(config: OpenAIProviderConfig = {}) {
    this.client = config.client ?? new OpenAI({ apiKey: config.apiKey });
    this.model = config.model ?? DEFAULT_OPENAI_REVIEW_MODEL;
  }

  async generateJson(request: LlmProviderRequest): Promise<LlmProviderResponse> {
    const response = await this.client.chat.completions.create({
      messages: request.messages,
      model: request.model || this.model,
      response_format: {
        json_schema: {
          name: request.responseSchemaName,
          schema: request.responseSchema,
          strict: true,
        },
        type: "json_schema",
      },
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    });

    const content = response.choices[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new OpenAIProviderError("OpenAI response did not include structured JSON content.");
    }

    let output: unknown;
    try {
      output = JSON.parse(content);
    } catch {
      throw new OpenAIProviderError("OpenAI response content was not valid JSON.");
    }

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;

    return {
      model: response.model ?? request.model,
      output,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: response.usage?.total_tokens ?? inputTokens + outputTokens,
      },
    };
  }
}

export function createOpenAIProvider(config: OpenAIProviderConfig = {}): OpenAIProvider {
  return new OpenAIProvider(config);
}

export async function reviewDiffWithLlm(
  input: ReviewDiffWithLlmInput,
): Promise<ReviewDiffWithLlmResult> {
  const template = REVIEW_PROMPT_TEMPLATES[input.templateId];
  const modelCalls: ModelCallLog[] = [];
  const maxAttempts = (input.maxValidationRetries ?? 1) + 1;
  let validationFeedback: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAtMs = Date.now();
    const messages = buildPromptMessages(input, template, validationFeedback);

    let providerResponse: LlmProviderResponse;
    try {
      providerResponse = await input.provider.generateJson({
        messages,
        model: input.model ?? DEFAULT_OPENAI_REVIEW_MODEL,
        responseSchema: REVIEW_FINDING_JSON_SCHEMA,
        responseSchemaName: "diffguard_review_findings",
        temperature: 0,
      });
    } catch (error) {
      const call = createModelCallLog({
        attempt,
        input,
        latencyMs: Date.now() - startedAtMs,
        model: input.model ?? DEFAULT_OPENAI_REVIEW_MODEL,
        promptVersion: REVIEW_PROMPT_VERSION,
        status: "failed",
        tokenUsage: emptyTokenUsage(),
      });
      modelCalls.push(call);
      input.onModelCall?.(call);
      throw error;
    }

    const parsed = ReviewFindingOutputSchema.safeParse(providerResponse.output);
    const call = createModelCallLog({
      attempt,
      input,
      latencyMs: Date.now() - startedAtMs,
      model: providerResponse.model,
      promptVersion: REVIEW_PROMPT_VERSION,
      status: parsed.success ? "succeeded" : "invalid_output",
      tokenUsage: providerResponse.tokenUsage,
    });
    modelCalls.push(call);
    input.onModelCall?.(call);

    if (parsed.success) {
      return {
        findings: parsed.data.findings,
        modelCalls,
        promptVersion: template.version,
      };
    }

    const validationIssues = toValidationIssues(parsed.error);
    if (attempt === maxAttempts) {
      throw new LlmValidationError(validationIssues, modelCalls);
    }

    validationFeedback = buildValidationFeedback(validationIssues);
  }

  throw new LlmValidationError([], modelCalls);
}

export type ResolutionFindingInput = {
  category: string;
  confidence: number;
  evidence: string;
  filePath: string;
  githubCommentId: string;
  id: string;
  line: number;
  severity: string;
  side: "LEFT" | "RIGHT";
  summary: string;
  suggestedFix?: string;
  title: string;
  whyItMatters: string;
};

export type FindingValidationCandidateInput = {
  category: string;
  confidence: number;
  evidence: string;
  filePath: string;
  improvedComment?: string;
  line: number;
  relatedRuleIds: string[];
  severity: string;
  side: "LEFT" | "RIGHT";
  summary: string;
  suggestedFix: string;
  title: string;
  whyItMatters: string;
};

export type ValidateFindingWithLlmInput = {
  changedFilePatch: string | null;
  diff: string;
  finding: FindingValidationCandidateInput;
  model?: string;
  onModelCall?: (call: ModelCallLog) => void;
  pricing?: TokenPricing;
  provider: LlmProvider;
  providerName?: string;
  reviewerConfidence: number;
  rules: string | null;
  staticAnalysisContext: unknown[];
};

export type ValidateFindingWithLlmResult = z.infer<typeof FindingValidatorOutputSchema> & {
  modelCalls: ModelCallLog[];
  promptVersion: typeof VALIDATOR_PROMPT_VERSION;
};

export async function validateFindingWithLlm(
  input: ValidateFindingWithLlmInput,
): Promise<ValidateFindingWithLlmResult> {
  const startedAtMs = Date.now();
  const modelCalls: ModelCallLog[] = [];

  let providerResponse: LlmProviderResponse;
  try {
    providerResponse = await input.provider.generateJson({
      messages: buildFindingValidatorMessages(input),
      model: input.model ?? DEFAULT_OPENAI_REVIEW_MODEL,
      responseSchema: FINDING_VALIDATION_JSON_SCHEMA,
      responseSchemaName: "diffguard_finding_validation",
      temperature: 0,
    });
  } catch (error) {
    const call = createModelCallLog({
      attempt: 1,
      input,
      latencyMs: Date.now() - startedAtMs,
      model: input.model ?? DEFAULT_OPENAI_REVIEW_MODEL,
      promptVersion: VALIDATOR_PROMPT_VERSION,
      status: "failed",
      tokenUsage: emptyTokenUsage(),
    });
    modelCalls.push(call);
    input.onModelCall?.(call);
    throw error;
  }

  const parsed = FindingValidatorOutputSchema.safeParse(providerResponse.output);
  const call = createModelCallLog({
    attempt: 1,
    input,
    latencyMs: Date.now() - startedAtMs,
    model: providerResponse.model,
    promptVersion: VALIDATOR_PROMPT_VERSION,
    status: parsed.success ? "succeeded" : "invalid_output",
    tokenUsage: providerResponse.tokenUsage,
  });
  modelCalls.push(call);
  input.onModelCall?.(call);

  if (!parsed.success) {
    throw new LlmValidationError(toValidationIssues(parsed.error), modelCalls);
  }

  return {
    ...parsed.data,
    modelCalls,
    promptVersion: VALIDATOR_PROMPT_VERSION,
  };
}

export type ValidateFindingResolutionWithLlmInput = {
  finding: ResolutionFindingInput;
  latestCodeContext: string[];
  latestDiff: string;
  model?: string;
  onModelCall?: (call: ModelCallLog) => void;
  pricing?: TokenPricing;
  provider: LlmProvider;
  providerName?: string;
};

export type ValidateFindingResolutionWithLlmResult = z.infer<
  typeof ResolutionValidatorOutputSchema
> & {
  modelCalls: ModelCallLog[];
  promptVersion: typeof RESOLUTION_VALIDATOR_PROMPT_VERSION;
};

export async function validateFindingResolutionWithLlm(
  input: ValidateFindingResolutionWithLlmInput,
): Promise<ValidateFindingResolutionWithLlmResult> {
  const startedAtMs = Date.now();
  const modelCalls: ModelCallLog[] = [];

  let providerResponse: LlmProviderResponse;
  try {
    providerResponse = await input.provider.generateJson({
      messages: buildResolutionValidatorMessages(input),
      model: input.model ?? DEFAULT_OPENAI_REVIEW_MODEL,
      responseSchema: RESOLUTION_STATUS_JSON_SCHEMA,
      responseSchemaName: "diffguard_resolution_status",
      temperature: 0,
    });
  } catch (error) {
    const call = createModelCallLog({
      attempt: 1,
      input,
      latencyMs: Date.now() - startedAtMs,
      model: input.model ?? DEFAULT_OPENAI_REVIEW_MODEL,
      promptVersion: RESOLUTION_VALIDATOR_PROMPT_VERSION,
      status: "failed",
      tokenUsage: emptyTokenUsage(),
    });
    modelCalls.push(call);
    input.onModelCall?.(call);
    throw error;
  }

  const parsed = ResolutionValidatorOutputSchema.safeParse(providerResponse.output);
  const call = createModelCallLog({
    attempt: 1,
    input,
    latencyMs: Date.now() - startedAtMs,
    model: providerResponse.model,
    promptVersion: RESOLUTION_VALIDATOR_PROMPT_VERSION,
    status: parsed.success ? "succeeded" : "invalid_output",
    tokenUsage: providerResponse.tokenUsage,
  });
  modelCalls.push(call);
  input.onModelCall?.(call);

  if (!parsed.success) {
    throw new LlmValidationError(toValidationIssues(parsed.error), modelCalls);
  }

  return {
    ...parsed.data,
    modelCalls,
    promptVersion: RESOLUTION_VALIDATOR_PROMPT_VERSION,
  };
}

function buildPromptMessages(
  input: ReviewPromptInput,
  template: ReviewPromptTemplate,
  validationFeedback?: string,
): LlmMessage[] {
  const messages: LlmMessage[] = [
    {
      content: template.system,
      role: "system",
    },
    {
      content: template.buildUserMessage(input),
      role: "user",
    },
  ];

  if (validationFeedback !== undefined) {
    messages.push({
      content: validationFeedback,
      role: "user",
    });
  }

  return messages;
}

function buildReviewUserMessage(input: ReviewPromptInput): string {
  const context = input.context?.length ? input.context.join("\n") : "No extra context files.";
  const rules = input.rules?.trim() ? input.rules : "No repository-specific rules were provided.";

  return [
    "Review this pull request diff for high-confidence findings only.",
    "",
    "Repository rules:",
    rules,
    "",
    "Context files:",
    context,
    "",
    "Diff:",
    input.diff,
  ].join("\n");
}

function buildFindingValidatorMessages(input: ValidateFindingWithLlmInput): LlmMessage[] {
  return [
    {
      content: [
        "Validate whether a candidate DiffGuard-AI review finding should be posted.",
        "Return only structured JSON that matches the provided schema.",
        "Approve only high-confidence, actionable engineering issues supported by the pull request diff.",
        "Reject style-only, formatting-only, subjective, vague, speculative, non-actionable, or high false-positive-risk findings.",
        "Use improvedComment to rewrite the comment only when it makes the finding more precise and actionable; otherwise return null.",
      ].join("\n"),
      role: "system",
    },
    {
      content: buildFindingValidatorUserMessage(input),
      role: "user",
    },
  ];
}

function buildFindingValidatorUserMessage(input: ValidateFindingWithLlmInput): string {
  return [
    "Repository rules:",
    input.rules?.trim() ? input.rules : "No repository-specific rules were provided.",
    "",
    "Reviewer confidence:",
    String(input.reviewerConfidence),
    "",
    "Candidate finding:",
    JSON.stringify(input.finding, null, 2),
    "",
    "Static analysis context:",
    input.staticAnalysisContext.length > 0
      ? JSON.stringify(input.staticAnalysisContext, null, 2)
      : "No static analysis context was available.",
    "",
    "Changed file patch:",
    input.changedFilePatch?.trim() ? input.changedFilePatch : "No changed file patch was available.",
    "",
    "Pull request diff:",
    input.diff.trim().length > 0 ? input.diff : "No pull request diff was available.",
  ].join("\n");
}

function buildValidationFeedback(issues: Array<{ message: string; path: string }>): string {
  return [
    "Previous output was invalid. Return a corrected JSON object that matches the schema exactly.",
    "Do not explain the corrections.",
    "Validation issues:",
    ...issues.map((issue) => `- ${issue.path || "<root>"}: ${issue.message}`),
  ].join("\n");
}

function createModelCallLog(input: {
  attempt: number;
  input: Pick<ReviewDiffWithLlmInput, "pricing" | "providerName">;
  latencyMs: number;
  model: string;
  promptVersion: string;
  status: ModelCallStatus;
  tokenUsage: TokenUsage;
}): ModelCallLog {
  return {
    attempt: input.attempt,
    costUsd: calculateCost(input.tokenUsage, input.input.pricing),
    latencyMs: input.latencyMs,
    model: input.model,
    promptVersion: input.promptVersion,
    provider: input.input.providerName ?? "unknown",
    status: input.status,
    tokenUsage: input.tokenUsage,
  };
}

function buildResolutionValidatorMessages(input: ValidateFindingResolutionWithLlmInput): LlmMessage[] {
  return [
    {
      content: [
        "Classify whether the original DiffGuard-AI finding is now resolved in the latest pull request code.",
        "Return only structured JSON that matches the provided schema.",
        "Use resolved only when the latest evidence clearly fixes the issue.",
        "Use unresolved when the issue still appears present.",
        "Use false_positive when the original claim appears unsupported by the current evidence.",
        "Use unknown when evidence is insufficient.",
      ].join("\n"),
      role: "system",
    },
    {
      content: buildResolutionValidatorUserMessage(input),
      role: "user",
    },
  ];
}

function buildResolutionValidatorUserMessage(input: ValidateFindingResolutionWithLlmInput): string {
  return [
    "Original finding:",
    JSON.stringify(input.finding, null, 2),
    "",
    "Latest code context:",
    input.latestCodeContext.length > 0
      ? input.latestCodeContext.join("\n\n")
      : "No latest code context was available.",
    "",
    "Latest pull request diff:",
    input.latestDiff.trim().length > 0 ? input.latestDiff : "No latest diff was available.",
  ].join("\n");
}

function calculateCost(usage: TokenUsage, pricing: TokenPricing | undefined): number {
  if (pricing === undefined) {
    return 0;
  }

  return (
    (usage.inputTokens / 1_000_000) * pricing.inputUsdPerMillionTokens +
    (usage.outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens
  );
}

function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function toValidationIssues(error: z.ZodError): Array<{ message: string; path: string }> {
  return error.issues.map((issue) => ({
    message: issue.message,
    path: issue.path.join("."),
  }));
}
