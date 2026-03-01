import { describe, expect, it } from "vitest";
import {
  assertEffects,
  assertGuards,
  formatStepValidationError,
  validateEffects,
  validateGuards,
} from "../src/core/step-validation.js";
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

  it("returns typed guard validation error result", async () => {
    const step: RecipeStep = {
      id: "s3",
      title: "guard typed result",
      mode: "http",
      action: "fetch",
      guards: [{ type: "url_is", value: "https://example.com/path" }],
    };

    const result = await validateGuards(step, { currentUrl: "https://example.com/other" });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("guard_failed");
      expect(formatStepValidationError(result.error)).toMatch(/Guard failed/);
    }
  });

  it("returns typed effect validation error result", async () => {
    const step: RecipeStep = {
      id: "s4",
      title: "effect typed result",
      mode: "pw",
      action: "goto",
      effects: [{ type: "url_changed", value: "https://example.com/after" }],
    };

    const result = await validateEffects(step, {
      beforeUrl: "https://example.com/before",
      currentUrl: "https://example.com/unexpected",
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("effect_failed");
      expect(formatStepValidationError(result.error)).toMatch(/Effect failed/);
    }
  });

  it("formats unexpected validation error", () => {
    const message = formatStepValidationError({
      kind: "unexpected_error",
      stepId: "s5",
      phase: "guard",
      message: "boom",
    });
    expect(message).toContain("Unexpected validation error");
    expect(message).toContain("step=s5");
  });
});
