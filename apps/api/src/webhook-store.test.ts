import { describe, expect, it, vi } from "vitest";

import { createPrismaWebhookStore } from "./webhook-store.js";

describe("createPrismaWebhookStore", () => {
  it("persists webhook delivery records for idempotency", async () => {
    const database = createDatabaseDouble();
    const store = createPrismaWebhookStore(database);

    const result = await store.recordDelivery({
      action: "opened",
      deliveryId: "delivery-1",
      eventName: "pull_request",
    });

    expect(result).toEqual({ duplicate: false });
    expect(database.webhookDelivery.create).toHaveBeenCalledWith({
      data: {
        action: "opened",
        deliveryId: "delivery-1",
        eventName: "pull_request",
        processedAt: expect.any(Date),
      },
    });
  });

  it("treats unique delivery id conflicts as duplicate deliveries", async () => {
    const database = createDatabaseDouble();
    database.webhookDelivery.create.mockRejectedValueOnce({ code: "P2002" });
    const store = createPrismaWebhookStore(database);

    await expect(
      store.recordDelivery({
        deliveryId: "delivery-1",
        eventName: "pull_request",
      }),
    ).resolves.toEqual({ duplicate: true });
  });
});

function createDatabaseDouble() {
  return {
    pullRequest: {
      upsert: vi.fn(),
    },
    repository: {
      upsert: vi.fn(),
    },
    reviewRun: {
      create: vi.fn(),
    },
    webhookDelivery: {
      create: vi.fn(async () => ({})),
    },
  };
}
