import fs from "node:fs/promises";
import path from "node:path";
import type { Recipe } from "../types.js";
import { ensureBaseDirs, recipePath } from "./fs.js";
import { RECIPES_DIR } from "./paths.js";

export const saveRecipe = async (recipe: Recipe): Promise<void> => {
  await ensureBaseDirs();
  await fs.writeFile(recipePath(recipe.id), JSON.stringify(recipe, null, 2), "utf-8");
};

export const loadRecipe = async (name: string): Promise<Recipe> => {
  const text = await fs.readFile(recipePath(name), "utf-8");
  return JSON.parse(text) as Recipe;
};

export const listRecipes = async (): Promise<Recipe[]> => {
  await ensureBaseDirs();
  const files = await fs.readdir(RECIPES_DIR);
  const recipeFiles = files.filter((f) => f.endsWith(".recipe.json"));
  const recipes = await Promise.all(
    recipeFiles.map(async (f) => {
      const text = await fs.readFile(path.join(RECIPES_DIR, f), "utf-8");
      return JSON.parse(text) as Recipe;
    }),
  );
  return recipes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};
