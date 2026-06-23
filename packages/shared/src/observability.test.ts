import { describe, expect, it } from "vitest";

import {
  createJsonLogger,
  redactLogValue,
  sanitizeLogFields,
  toErrorLogFields,
} from "./observability.js";

describe("observability redaction", () => {
  it("redacts secret-like strings and raw authorization headers", () => {
    const redacted = redactLogValue(
      [
        "Authorization: Bearer ghs_installation_token_12345",
        "OPENAI_API_KEY=sk-proj-secret12345",
        "GITHUB_APP_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      ].join("\n"),
    );

    expect(redacted).toContain("Authorization: Bearer [redacted]");
    expect(redacted).toContain("OPENAI_API_KEY=[redacted]");
    expect(redacted).toContain("GITHUB_APP_PRIVATE_KEY=[redacted]");
    expect(redacted).not.toContain("ghs_installation_token");
    expect(redacted).not.toContain("sk-proj-secret");
    expect(redacted).not.toContain("BEGIN PRIVATE KEY");
  });

  it("redacts sensitive object fields while preserving observability dimensions", () => {
    const sanitized = sanitizeLogFields({
      authorization: "Bearer github_pat_secret",
      estimatedCostUsd: 0.0123,
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      githubToken: "ghp_secret12345",
      installationToken: "ghs_installation_secret",
      modelName: "gpt-5-mini",
      OPENAI_API_KEY: "sk-proj-secret12345",
      prompt: "full prompt contents must not be logged",
      promptVersion: "reviewer:v1",
      pullNumber: 42,
      repository: "acme/widgets",
      requestId: "req-1",
      reviewRunId: "rvw_1",
      status: "completed",
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 125,
      },
      webhookDeliveryId: "delivery-1",
    });

    expect(sanitized).toMatchObject({
      authorization: "[redacted]",
      estimatedCostUsd: 0.0123,
      GITHUB_APP_PRIVATE_KEY: "[redacted]",
      githubToken: "[redacted]",
      installationToken: "[redacted]",
      modelName: "gpt-5-mini",
      OPENAI_API_KEY: "[redacted]",
      prompt: "[redacted]",
      promptVersion: "reviewer:v1",
      pullNumber: 42,
      repository: "acme/widgets",
      requestId: "req-1",
      reviewRunId: "rvw_1",
      status: "completed",
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 125,
      },
      webhookDeliveryId: "delivery-1",
    });
  });

  it("redacts error messages before structured logging", () => {
    const logs: string[] = [];
    const logger = createJsonLogger({
      service: "test",
      sink: (line) => logs.push(line),
    });

    logger.error(
      {
        ...toErrorLogFields(new Error("failed with token=ghs_installation_token_12345")),
        requestId: "req-1",
      },
      "request failed",
    );

    const entry = JSON.parse(logs[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "error",
      message: "request failed",
      requestId: "req-1",
      service: "test",
    });
    expect(JSON.stringify(entry)).toContain("[redacted]");
    expect(JSON.stringify(entry)).not.toContain("ghs_installation_token");
  });
});
