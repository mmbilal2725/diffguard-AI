import { z } from "zod";

const WorkerEnvSchema = z.object({
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  DIFFGUARD_REVIEW_PASSES: z.string().min(1).optional(),
  DIFFGUARD_STATIC_CHECKS: z.string().min(1).optional(),
  DIFFGUARD_VALIDATOR_MODEL: z.string().min(1).optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_RESOLUTION_MODEL: z.string().min(1).optional(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  REVIEW_QUEUE_NAME: z.string().min(1).default("diffguard-review-runs"),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3002),
});

export type WorkerConfig = {
  diffguardValidatorModel?: string;
  githubAppId?: string;
  githubAppPrivateKey?: string;
  openaiApiKey?: string;
  openaiResolutionModel?: string;
  reviewPasses?: string;
  redisUrl: string;
  queueName: string;
  staticChecksEnabled: boolean;
  workerHealthPort: number;
};

export function createWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const parsed = WorkerEnvSchema.parse(env);
  validateProductionConfig(parsed);

  return {
    diffguardValidatorModel: parsed.DIFFGUARD_VALIDATOR_MODEL,
    githubAppId: parsed.GITHUB_APP_ID,
    githubAppPrivateKey: parsed.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    openaiApiKey: parsed.OPENAI_API_KEY,
    openaiResolutionModel: parsed.OPENAI_RESOLUTION_MODEL,
    reviewPasses: parsed.DIFFGUARD_REVIEW_PASSES,
    redisUrl: parsed.REDIS_URL,
    queueName: parsed.REVIEW_QUEUE_NAME,
    staticChecksEnabled: parseStaticChecksEnabled(parsed.DIFFGUARD_STATIC_CHECKS),
    workerHealthPort: parsed.WORKER_HEALTH_PORT,
  };
}

function validateProductionConfig(parsed: z.infer<typeof WorkerEnvSchema>): void {
  if (parsed.NODE_ENV !== "production") {
    return;
  }

  const missing: string[] = [];
  if (parsed.GITHUB_APP_ID === undefined) {
    missing.push("GITHUB_APP_ID");
  }
  if (parsed.GITHUB_APP_PRIVATE_KEY === undefined) {
    missing.push("GITHUB_APP_PRIVATE_KEY");
  }
  if (parsed.OPENAI_API_KEY === undefined) {
    missing.push("OPENAI_API_KEY");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
}

function parseStaticChecksEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  return normalized !== "false" && normalized !== "0" && normalized !== "off" && normalized !== "disabled";
}
