import { describe, expect, it } from "vitest";

import { createDatabaseClient } from "./index.js";

describe("createDatabaseClient", () => {
  it("creates a Prisma client without connecting to the database", () => {
    const client = createDatabaseClient();

    expect(client).toHaveProperty("$connect");
    expect(client).toHaveProperty("$disconnect");
  });
});
