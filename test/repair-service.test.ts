import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { recipePath } from "../src/core/fs.js";
import { saveRecipeResult } from "../src/core/recipe-store.js";
import { repairServiceResult } from "../src/services/repair-service.js";
import type { Recipe } from "../src/types.js";

const createdPaths = new Set<string>();

const uniqueName = (prefix: string): string => {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const sampleRecipe = (id: string): Recipe => ({
  schemaVersion: 1,
  id,
  name: id,
  version: 1,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  source: "compiled",
  steps: [
    {
      id: "s1",
      title: "click",
      mode: "pw",
      action: "click",
      selectorVariants: ["#a", "#b", "#a"],
    },
  ],
  fallback: { selectorReSearch: true, selectorVariants: [], allowRepair: true },
});

afterEach(async () => {
  for (const filePath of createdPaths) {
    try {
      await fs.unlink(filePath);
    } catch {
      // noop
    }
  }
  createdPaths.clear();
});

describe("repair-service", () => {
  it("returns recipe_not_found for missing recipe", async () => {
    const result = await repairServiceResult("nonexistent-recipe-xyz");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe("recipe_not_found");
    }
  });

  it("increments version and deduplicates selectors", async () => {
    const id = uniqueName("repair-svc");
    const filePath = recipePath(id);
    createdPaths.add(filePath);

    await saveRecipeResult(sampleRecipe(id));

    const result = await repairServiceResult(id);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.recipe.version).toBe(2);
      expect(result.value.recipe.source).toBe("repaired");
      expect(result.value.recipe.steps[0].selectorVariants).toEqual(["#a", "#b"]);
    }
  });
});
