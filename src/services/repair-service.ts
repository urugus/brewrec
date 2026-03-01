import { type Result, err, ok } from "neverthrow";
import {
  formatRecipeStoreError,
  loadRecipeResult,
  saveRecipeResult,
} from "../core/recipe-store.js";
import type { RepairResult, ServiceError } from "./types.js";

export const repairServiceResult = async (
  name: string,
): Promise<Result<RepairResult, ServiceError>> => {
  const recipeResult = await loadRecipeResult(name);
  if (recipeResult.isErr()) {
    const code =
      recipeResult.error.kind === "recipe_read_failed" ? "recipe_not_found" : "recipe_load_failed";
    return err({ code, message: formatRecipeStoreError(recipeResult.error) });
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
    return err({ code: "recipe_save_failed", message: formatRecipeStoreError(saveResult.error) });
  }
  return ok({ recipe: patched });
};
