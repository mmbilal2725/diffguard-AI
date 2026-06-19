import { describe, expect, it } from "vitest";

import { isPostableFinding } from "./index.js";

describe("isPostableFinding", () => {
  it("only allows high-confidence findings to be posted", () => {
    expect(isPostableFinding({ confidence: 0.9 })).toBe(true);
    expect(isPostableFinding({ confidence: 0.69 })).toBe(false);
  });
});
