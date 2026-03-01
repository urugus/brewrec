import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recipePath } from "../src/core/fs.js";
import { RECIPES_DIR } from "../src/core/paths.js";
import {
  formatRecipeStoreError,
  listRecipesResult,
  loadRecipe,
  loadRecipeResult,
  saveRecipeResult,
} from "../src/core/recipe-store.js";
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
  steps: [],
  fallback: {
    selectorReSearch: true,
    selectorVariants: [],
    allowRepair: true,
  },
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

describe("recipe-store result APIs", () => {
  it("saves and loads recipe via Result API", async () => {
    const id = uniqueName("recipe-store-ok");
    const filePath = recipePath(id);
    createdPaths.add(filePath);
    const recipe = sampleRecipe(id);

    const saveResult = await saveRecipeResult(recipe);
    expect(saveResult.isOk()).toBe(true);

    const loadResult = await loadRecipeResult(id);
    expect(loadResult.isOk()).toBe(true);
    if (loadResult.isOk()) {
      expect(loadResult.value.id).toBe(id);
      expect(loadResult.value.version).toBe(1);
    }
  });

  it("returns typed read error when recipe file does not exist", async () => {
    const id = uniqueName("recipe-store-missing");
    const result = await loadRecipeResult(id);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("recipe_read_failed");
      expect(formatRecipeStoreError(result.error)).toContain("Recipe read failed");
    }
  });

  it("returns typed parse error for malformed recipe JSON", async () => {
    const id = uniqueName("recipe-store-parse");
    const filePath = recipePath(id);
    createdPaths.add(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "not-json", "utf-8");

    const result = await loadRecipeResult(id);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("recipe_parse_failed");
    }
  });

  it("returns typed list parse error when listing malformed recipe file", async () => {
    const filePath = path.join(RECIPES_DIR, `${uniqueName("recipe-store-list-bad")}.recipe.json`);
    createdPaths.add(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{", "utf-8");

    const result = await listRecipesResult();
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("recipe_list_parse_failed");
    }
  });

  it("compatibility API throws formatted error", async () => {
    const id = uniqueName("recipe-store-compat-missing");
    await expect(loadRecipe(id)).rejects.toThrow(/Recipe read failed/);
  });
});
