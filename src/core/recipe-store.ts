import fs from "node:fs/promises";
import path from "node:path";
import { type Result, err, ok } from "neverthrow";
import type { Recipe } from "../types.js";
import { ensureBaseDirs, recipePath } from "./fs.js";
import { RECIPES_DIR } from "./paths.js";

export type RecipeStoreError =
  | {
      kind: "ensure_base_dirs_failed";
      message: string;
    }
  | {
      kind: "recipe_read_failed";
      recipeName: string;
      message: string;
    }
  | {
      kind: "recipe_parse_failed";
      recipeName: string;
      message: string;
    }
  | {
      kind: "recipe_write_failed";
      recipeId: string;
      message: string;
    }
  | {
      kind: "recipes_list_failed";
      message: string;
    }
  | {
      kind: "recipe_list_parse_failed";
      fileName: string;
      message: string;
    };

export const formatRecipeStoreError = (error: RecipeStoreError): string => {
  if (error.kind === "ensure_base_dirs_failed") {
    return `Base directory preparation failed: ${error.message}`;
  }
  if (error.kind === "recipe_read_failed") {
    return `Recipe read failed (${error.recipeName}): ${error.message}`;
  }
  if (error.kind === "recipe_parse_failed") {
    return `Recipe parse failed (${error.recipeName}): ${error.message}`;
  }
  if (error.kind === "recipe_write_failed") {
    return `Recipe write failed (${error.recipeId}): ${error.message}`;
  }
  if (error.kind === "recipe_list_parse_failed") {
    return `Recipe list parse failed (${error.fileName}): ${error.message}`;
  }
  return `Recipe list failed: ${error.message}`;
};

const causeMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  return String(cause);
};

export const saveRecipeResult = async (recipe: Recipe): Promise<Result<void, RecipeStoreError>> => {
  try {
    await ensureBaseDirs();
  } catch (cause) {
    return err({ kind: "ensure_base_dirs_failed", message: causeMessage(cause) });
  }

  try {
    await fs.writeFile(recipePath(recipe.id), JSON.stringify(recipe, null, 2), "utf-8");
    return ok(undefined);
  } catch (cause) {
    return err({
      kind: "recipe_write_failed",
      recipeId: recipe.id,
      message: causeMessage(cause),
    });
  }
};

export const loadRecipeResult = async (name: string): Promise<Result<Recipe, RecipeStoreError>> => {
  let text = "";
  try {
    text = await fs.readFile(recipePath(name), "utf-8");
  } catch (cause) {
    return err({ kind: "recipe_read_failed", recipeName: name, message: causeMessage(cause) });
  }

  try {
    return ok(JSON.parse(text) as Recipe);
  } catch (cause) {
    return err({ kind: "recipe_parse_failed", recipeName: name, message: causeMessage(cause) });
  }
};

export const listRecipesResult = async (): Promise<Result<Recipe[], RecipeStoreError>> => {
  try {
    await ensureBaseDirs();
  } catch (cause) {
    return err({ kind: "ensure_base_dirs_failed", message: causeMessage(cause) });
  }

  let files: string[] = [];
  try {
    files = await fs.readdir(RECIPES_DIR);
  } catch (cause) {
    return err({ kind: "recipes_list_failed", message: causeMessage(cause) });
  }

  const recipeFiles = files.filter((f) => f.endsWith(".recipe.json"));
  const recipes: Recipe[] = [];

  for (const fileName of recipeFiles) {
    let text = "";
    try {
      text = await fs.readFile(path.join(RECIPES_DIR, fileName), "utf-8");
    } catch (cause) {
      return err({ kind: "recipes_list_failed", message: causeMessage(cause) });
    }

    try {
      recipes.push(JSON.parse(text) as Recipe);
    } catch (cause) {
      return err({
        kind: "recipe_list_parse_failed",
        fileName,
        message: causeMessage(cause),
      });
    }
  }

  recipes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return ok(recipes);
};

export const saveRecipe = async (recipe: Recipe): Promise<void> => {
  const result = await saveRecipeResult(recipe);
  if (result.isErr()) {
    throw new Error(formatRecipeStoreError(result.error));
  }
};

export const loadRecipe = async (name: string): Promise<Recipe> => {
  const result = await loadRecipeResult(name);
  if (result.isErr()) {
    throw new Error(formatRecipeStoreError(result.error));
  }
  return result.value;
};

export const listRecipes = async (): Promise<Recipe[]> => {
  const result = await listRecipesResult();
  if (result.isErr()) {
    throw new Error(formatRecipeStoreError(result.error));
  }
  return result.value;
};
