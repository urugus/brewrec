import { loadRecipe, saveRecipe } from "../core/recipe-store.js";

export async function repairCommand(name: string): Promise<void> {
  const recipe = await loadRecipe(name);

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

  await saveRecipe(patched);
}
