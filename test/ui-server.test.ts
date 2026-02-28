import { describe, expect, it } from "vitest";
import type { Recipe } from "../src/types.js";
import { _uiInternals } from "../src/ui/server.js";

const baseRecipe = (): Recipe => ({
  schemaVersion: 1,
  id: "sample",
  name: "sample",
  version: 1,
  createdAt: "2026-02-28T00:00:00.000Z",
  updatedAt: "2026-02-28T00:00:00.000Z",
  source: "compiled",
  steps: [
    {
      id: "s1",
      title: "goto",
      mode: "pw",
      action: "goto",
      url: "https://example.com",
    },
  ],
  fallback: {
    selectorReSearch: true,
    selectorVariants: [],
    allowRepair: true,
  },
});

describe("ui payload validation", () => {
  it("accepts valid recipe payload", () => {
    expect(_uiInternals.isValidRecipe(baseRecipe())).toBe(true);
  });

  it("rejects invalid step action", () => {
    const invalid = {
      ...baseRecipe(),
      steps: [
        {
          id: "s1",
          title: "bad",
          mode: "pw",
          action: "bad-action",
        },
      ],
    };

    expect(_uiInternals.isValidRecipe(invalid)).toBe(false);
  });

  it("rejects payload without fallback", () => {
    const invalid = {
      ...baseRecipe(),
      fallback: undefined,
    };

    expect(_uiInternals.isValidRecipe(invalid)).toBe(false);
  });
});
