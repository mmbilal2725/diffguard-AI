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
      REDIS_URL: "redis://redis.example.test:6379",
      REVIEW_QUEUE_NAME: "custom-review-queue"
    });

    expect(config.redisUrl).toBe("redis://redis.example.test:6379");
    expect(config.queueName).toBe("custom-review-queue");
  });
});
