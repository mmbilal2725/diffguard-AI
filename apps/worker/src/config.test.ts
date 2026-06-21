import { describe, expect, it } from "vitest";

import { createWorkerConfig } from "./config.js";

describe("createWorkerConfig", () => {
  it("uses a safe local Redis default when REDIS_URL is missing", () => {
    const config = createWorkerConfig({});

    expect(config.redisUrl).toBe("redis://localhost:6379");
    expect(config.queueName).toBe("diffguard-review-runs");
  });

  it("accepts explicit Redis and queue settings", () => {
    const config = createWorkerConfig({
      DIFFGUARD_REVIEW_PASSES: "logic-bugs,security-bugs",
      OPENAI_API_KEY: "sk-test",
      OPENAI_RESOLUTION_MODEL: "gpt-5.5-mini",
      REDIS_URL: "redis://redis.example.test:6379",
      REVIEW_QUEUE_NAME: "custom-review-queue"
    });

    expect(config.openaiApiKey).toBe("sk-test");
    expect(config.openaiResolutionModel).toBe("gpt-5.5-mini");
    expect(config.reviewPasses).toBe("logic-bugs,security-bugs");
    expect(config.redisUrl).toBe("redis://redis.example.test:6379");
    expect(config.queueName).toBe("custom-review-queue");
  });
});
