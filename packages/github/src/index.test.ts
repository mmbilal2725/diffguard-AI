import { describe, expect, it } from "vitest";

import { buildPullRequestKey } from "./index.js";

describe("buildPullRequestKey", () => {
  it("builds a stable repository pull request key", () => {
    expect(buildPullRequestKey({ owner: "openai", repo: "codex", number: 17 })).toBe(
      "openai/codex#17",
    );
  });
});
