import { type Result, err, ok } from "neverthrow";
import { buildExecutionPlanResult, formatBuildExecutionPlanError } from "../core/execution-plan.js";
import { formatRecipeStoreError, loadRecipeResult } from "../core/recipe-store.js";
import { formatTemplateVarError, parseCliVariablesResult } from "../core/template-vars.js";
import type { PlanResult, ServiceError } from "./types.js";

export type PlanServiceOptions = {
  vars?: string[];
  llmCommand?: string;
};

export const planServiceResult = async (
  name: string,
  options: PlanServiceOptions = {},
): Promise<Result<PlanResult, ServiceError>> => {
  const recipeResult = await loadRecipeResult(name);
  if (recipeResult.isErr()) {
    const code =
      recipeResult.error.kind === "recipe_read_failed" ? "recipe_not_found" : "recipe_load_failed";
    return err({ code, message: formatRecipeStoreError(recipeResult.error) });
  }
  const recipe = recipeResult.value;

  const cliVarsResult = parseCliVariablesResult(options.vars ?? []);
  if (cliVarsResult.isErr()) {
    return err({ code: "invalid_vars", message: formatTemplateVarError(cliVarsResult.error) });
  }

  const planResult = await buildExecutionPlanResult(recipe, {
    cliVars: cliVarsResult.value,
    llmCommand: options.llmCommand,
  });
  if (planResult.isErr()) {
    return err({
      code: "plan_build_failed",
      message: formatBuildExecutionPlanError(planResult.error),
    });
  }

  const plan = planResult.value;
  if (plan.unresolvedVars.length > 0) {
    return err({
      code: "unresolved_vars",
      message: `Unresolved variables: ${plan.unresolvedVars.join(", ")}`,
    });
  }

  return ok({ name, version: recipe.version, plan, downloadDir: recipe.downloadDir });
};
