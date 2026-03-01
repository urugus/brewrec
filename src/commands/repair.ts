import {
  formatRecipeStoreError,
  loadRecipeResult,
  saveRecipeResult,
} from "../core/recipe-store.js";

export const repairCommand = async (name: string): Promise<void> => {
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
};
