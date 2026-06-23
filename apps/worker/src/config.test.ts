import { describe, expect, it } from "vitest";

import { createWorkerConfig } from "./config.js";

describe("createWorkerConfig", () => {
  it("uses a safe local Redis default when REDIS_URL is missing", () => {
    const config = createWorkerConfig({});

    expect(config.redisUrl).toBe("redis://localhost:6379");
    expect(config.queueName).toBe("diffguard-review-runs");
    expect(config.workerHealthPort).toBe(3002);
  });

  it("accepts explicit Redis and queue settings", () => {
    const config = createWorkerConfig({
      DIFFGUARD_REVIEW_PASSES: "logic-bugs,security-bugs",
      DIFFGUARD_STATIC_CHECKS: "false",
      DIFFGUARD_VALIDATOR_MODEL: "gpt-5.5-validator",
      OPENAI_API_KEY: "sk-test",
      OPENAI_RESOLUTION_MODEL: "gpt-5.5-mini",
      REDIS_URL: "redis://redis.example.test:6379",
      REVIEW_QUEUE_NAME: "custom-review-queue",
      WORKER_HEALTH_PORT: "3012",
    });

    expect(config.openaiApiKey).toBe("sk-test");
    expect(config.openaiResolutionModel).toBe("gpt-5.5-mini");
    expect(config.diffguardValidatorModel).toBe("gpt-5.5-validator");
    expect(config.reviewPasses).toBe("logic-bugs,security-bugs");
    expect(config.staticChecksEnabled).toBe(false);
    expect(config.redisUrl).toBe("redis://redis.example.test:6379");
    expect(config.queueName).toBe("custom-review-queue");
    expect(config.workerHealthPort).toBe(3012);
  });
});
