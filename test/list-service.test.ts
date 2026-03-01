import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { recipePath } from "../src/core/fs.js";
import { saveRecipeResult } from "../src/core/recipe-store.js";
import { listRecipesServiceResult } from "../src/services/list-service.js";
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
  steps: [{ id: "s1", title: "goto", mode: "pw", action: "goto", url: "https://example.com" }],
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

describe("list-service", () => {
  it("returns empty list when no recipes exist", async () => {
    const result = await listRecipesServiceResult();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(Array.isArray(result.value.recipes)).toBe(true);
    }
  });

  it("lists saved recipes with summary fields", async () => {
    const id = uniqueName("list-svc");
    const filePath = recipePath(id);
    createdPaths.add(filePath);

    await saveRecipeResult(sampleRecipe(id));

    const result = await listRecipesServiceResult();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const found = result.value.recipes.find((r) => r.id === id);
      expect(found).toBeDefined();
      expect(found?.version).toBe(1);
      expect(found?.steps).toBe(1);
    }
  });
});
