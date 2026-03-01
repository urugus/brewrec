import { type Result, err, ok } from "neverthrow";
import {
  formatRecipeStoreError,
  loadRecipeResult,
  saveRecipeResult,
} from "../core/recipe-store.js";
import type { CommandError } from "./result.js";
import { toCommandError } from "./result.js";

export const repairCommand = async (name: string): Promise<void> => {
  const result = await repairCommandResult(name);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
};

export const repairCommandResult = async (name: string): Promise<Result<void, CommandError>> => {
  try {
    const recipeResult = await loadRecipeResult(name);
    if (recipeResult.isErr()) {
      throw new Error(formatRecipeStoreError(recipeResult.error));
    }
    const recipe = recipeResult.value;

    const patched = {
      ...recipe,
      version: recipe.version + 1,
      source: "repaired" as const,
      updatedAt: new Date().toISOString(),
      notes: `${recipe.notes ?? ""}\nRepaired with fallback selector refresh.`.trim(),
      steps: recipe.steps.map((step) => ({
        ...step,
        selectorVariants: Array.from(new Set(step.selectorVariants ?? [])).slice(0, 5),
      })),
    };

    const saveResult = await saveRecipeResult(patched);
    if (saveResult.isErr()) {
      throw new Error(formatRecipeStoreError(saveResult.error));
    }
    return ok(undefined);
  } catch (cause) {
    return err(toCommandError("repair", cause));
  }
};
