import { describe, expect, it } from "vitest";
import { assertEffects, assertGuards } from "../src/core/step-validation.js";
import type { RecipeStep } from "../src/types.js";

describe("step validation", () => {
  it("passes and fails url guards", async () => {
    const step: RecipeStep = {
      id: "s1",
      title: "guard test",
      mode: "http",
      action: "fetch",
      guards: [{ type: "url_is", value: "https://example.com/path" }],
    };

    await expect(
      assertGuards(step, { currentUrl: "https://example.com/path" }),
    ).resolves.toBeUndefined();

    await expect(assertGuards(step, { currentUrl: "https://example.com/other" })).rejects.toThrow(
      /Guard failed/,
    );
  });

  it("passes and fails url_changed effects", async () => {
    const step: RecipeStep = {
      id: "s2",
      title: "effect test",
      mode: "pw",
      action: "goto",
      effects: [{ type: "url_changed", value: "https://example.com/after" }],
    };

    await expect(
      assertEffects(step, {
        beforeUrl: "https://example.com/before",
        currentUrl: "https://example.com/after",
      }),
    ).resolves.toBeUndefined();

    await expect(
      assertEffects(step, {
        beforeUrl: "https://example.com/before",
        currentUrl: "https://example.com/unexpected",
      }),
    ).rejects.toThrow(/Effect failed/);
  });
});
