import { describe, expect, it } from "vitest";

import { calculatePrecision } from "./index.js";

describe("calculatePrecision", () => {
  it("returns zero when no findings were posted", () => {
    expect(calculatePrecision({ truePositives: 0, falsePositives: 0 })).toBe(0);
  });

  it("calculates true positives over posted findings", () => {
    expect(calculatePrecision({ truePositives: 8, falsePositives: 2 })).toBe(0.8);
  });
});
