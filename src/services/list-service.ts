import { type Result, err, ok } from "neverthrow";
import { formatRecipeStoreError, listRecipesResult } from "../core/recipe-store.js";
import type { ListResult, RecipeSummary, ServiceError } from "./types.js";

export const listRecipesServiceResult = async (): Promise<Result<ListResult, ServiceError>> => {
  const result = await listRecipesResult();
  if (result.isErr()) {
    return err({ code: "list_failed", message: formatRecipeStoreError(result.error) });
  }
  const recipes: RecipeSummary[] = result.value.map((r) => ({
    id: r.id,
    version: r.version,
    updatedAt: r.updatedAt,
    steps: r.steps.length,
  }));
  return ok({ recipes });
};
