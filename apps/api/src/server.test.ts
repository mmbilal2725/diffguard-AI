import { describe, expect, it } from "vitest";

import { buildApiServer } from "./server.js";

describe("buildApiServer", () => {
  it("returns ok from the health endpoint", async () => {
    const server = buildApiServer();

    const response = await server.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });

    await server.close();
  });
});
