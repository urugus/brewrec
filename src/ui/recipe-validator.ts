import { recipeSchema } from "../recipe-schema.js";
import type { Recipe } from "../types.js";

export const isValidRecipe = (value: unknown): value is Recipe => {
  return recipeSchema.safeParse(value).success;
};
