import { describe, expect, it } from "vitest";

import { createApiConfig } from "./config.js";

describe("createApiConfig", () => {
  it("uses safe local development defaults", () => {
    const config = createApiConfig({ NODE_ENV: "development" });

    expect(config.allowedOrigins).toEqual(["http://localhost:3000"]);
    expect(config.bodyLimitBytes).toBe(1_048_576);
    expect(config.dashboardApiKey).toBeUndefined();
    expect(config.demoMode).toBe(false);
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3001);
    expect(config.redisUrl).toBe("redis://localhost:6379");
    expect(config.reviewQueueName).toBe("diffguard-review-runs");
  });

  it("fails fast in production when dashboard API key is missing outside demo mode", () => {
    expect(() =>
      createApiConfig({
        DATABASE_URL: "postgresql://diffguard:diffguard@postgres:5432/diffguard",
        DIFFGUARD_ALLOWED_ORIGINS: "https://app.diffguard.ai",
        GITHUB_WEBHOOK_SECRET: "webhook-secret",
        NODE_ENV: "production",
        OPENAI_API_KEY: "sk-test",
      }),
    ).toThrow(/DIFFGUARD_DASHBOARD_API_KEY/);
  });

  it("allows missing dashboard API key only in explicit demo mode", () => {
    const config = createApiConfig({
      DATABASE_URL: "postgresql://diffguard:diffguard@postgres:5432/diffguard",
      DIFFGUARD_ALLOWED_ORIGINS: "https://app.diffguard.ai",
      DIFFGUARD_DEMO_MODE: "true",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      NODE_ENV: "production",
      OPENAI_API_KEY: "sk-test",
    });

    expect(config.demoMode).toBe(true);
    expect(config.dashboardApiKey).toBeUndefined();
  });

  it("fails fast when production GitHub App webhooks are missing a secret", () => {
    expect(() =>
      createApiConfig({
        DATABASE_URL: "postgresql://diffguard:diffguard@postgres:5432/diffguard",
        DIFFGUARD_ALLOWED_ORIGINS: "https://app.diffguard.ai",
        DIFFGUARD_DASHBOARD_API_KEY: "dashboard-secret",
        GITHUB_APP_ID: "12345",
        NODE_ENV: "production",
        OPENAI_API_KEY: "sk-test",
      }),
    ).toThrow(/GITHUB_WEBHOOK_SECRET/);
  });

  it("fails fast when production OpenAI key is missing", () => {
    expect(() =>
      createApiConfig({
        DATABASE_URL: "postgresql://diffguard:diffguard@postgres:5432/diffguard",
        DIFFGUARD_ALLOWED_ORIGINS: "https://app.diffguard.ai",
        DIFFGUARD_DASHBOARD_API_KEY: "dashboard-secret",
        GITHUB_WEBHOOK_SECRET: "webhook-secret",
        NODE_ENV: "production",
      }),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it("rejects wildcard or missing production CORS origins", () => {
    const baseEnv = {
      DATABASE_URL: "postgresql://diffguard:diffguard@postgres:5432/diffguard",
      DIFFGUARD_DASHBOARD_API_KEY: "dashboard-secret",
      GITHUB_WEBHOOK_SECRET: "webhook-secret",
      NODE_ENV: "production",
      OPENAI_API_KEY: "sk-test",
    };

    expect(() => createApiConfig(baseEnv)).toThrow(/DIFFGUARD_ALLOWED_ORIGINS/);
    expect(() => createApiConfig({ ...baseEnv, DIFFGUARD_ALLOWED_ORIGINS: "*" })).toThrow(
      /wildcard/,
    );
  });
});
