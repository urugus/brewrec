import { type Result, err, ok } from "neverthrow";
import { formatRunExecuteError, runPlanSteps, runPlanStepsWithAutoHeal } from "../commands/run.js";
import { resolveDownloadDir } from "../core/fs.js";
import {
  formatRecipeStoreError,
  loadRecipeResult,
  saveRecipeResult,
} from "../core/recipe-store.js";
import type { Recipe } from "../types.js";
import { planServiceResult } from "./plan-service.js";
import { nullReporter } from "./progress.js";
import type { ProgressReporter } from "./progress.js";
import type { RunResult, ServiceError } from "./types.js";

export type RunServiceOptions = {
  vars?: string[];
  llmCommand?: string;
  heal?: boolean;
  progress?: ProgressReporter;
};

export const runServiceResult = async (
  name: string,
  options: RunServiceOptions = {},
): Promise<Result<RunResult, ServiceError>> => {
  const progress = options.progress ?? nullReporter;

  const planResult = await planServiceResult(name, {
    vars: options.vars,
    llmCommand: options.llmCommand,
  });
  if (planResult.isErr()) {
    return err(planResult.error);
  }
  const { version, plan, downloadDir: recipeDownloadDir } = planResult.value;

  const downloadDir = await resolveDownloadDir(name, recipeDownloadDir);

  const modeLabel = options.heal ? "Running (heal)" : "Running";
  progress({ type: "info", message: `${modeLabel} ${plan.steps.length} steps...` });

  if (options.heal) {
    const llmCommand = options.llmCommand ?? "claude";
    const healResult = await runPlanStepsWithAutoHeal(plan.steps, llmCommand, downloadDir);
    if (healResult.isErr()) {
      const errorMessage = formatRunExecuteError(healResult.error);
      progress({ type: "warn", message: errorMessage });
      return ok({
        name,
        version,
        ok: false,
        phase: "execute",
        resolvedVars: plan.resolvedVars,
        warnings: plan.warnings,
        error: errorMessage,
      });
    }

    const { phase1Healed, selectorPatches } = healResult.value;
    if (phase1Healed > 0) {
      progress({
        type: "info",
        message: `Auto-healed ${phase1Healed} selector(s). Saving recipe...`,
      });
      const recipeResult = await loadRecipeResult(name);
      if (recipeResult.isOk()) {
        const recipe = recipeResult.value;
        const mergedSteps = recipe.steps.map((s) => {
          const newSelectors = selectorPatches.get(s.id);
          if (newSelectors) {
            return { ...s, selectorVariants: [...newSelectors, ...(s.selectorVariants ?? [])] };
          }
          return s;
        });
        const healed: Recipe = {
          ...recipe,
          version: recipe.version + 1,
          updatedAt: new Date().toISOString(),
          source: "healed",
          steps: mergedSteps,
          notes: `${recipe.notes ?? ""}\nSelf-healed: ${phase1Healed} auto-fixed.`.trim(),
        };
        const saveResult = await saveRecipeResult(healed);
        if (saveResult.isErr()) {
          progress({ type: "warn", message: formatRecipeStoreError(saveResult.error) });
        } else {
          progress({ type: "info", message: `Recipe saved as v${healed.version}.` });
        }
      }
    }

    progress({ type: "info", message: "Run (heal) completed successfully." });
    return ok({
      name,
      version: version + (phase1Healed > 0 ? 1 : 0),
      ok: true,
      phase: "execute",
      resolvedVars: plan.resolvedVars,
      warnings: plan.warnings,
    });
  }

  const executeResult = await runPlanSteps(plan.steps, downloadDir);
  if (executeResult.isErr()) {
    const errorMessage = formatRunExecuteError(executeResult.error);
    progress({ type: "warn", message: errorMessage });
    return ok({
      name,
      version,
      ok: false,
      phase: "execute",
      resolvedVars: plan.resolvedVars,
      warnings: plan.warnings,
      error: errorMessage,
    });
  }

  progress({ type: "info", message: "Run completed successfully." });
  return ok({
    name,
    version,
    ok: true,
    phase: "execute",
    resolvedVars: plan.resolvedVars,
    warnings: plan.warnings,
  });
};
