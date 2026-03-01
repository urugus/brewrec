import { type Result, err, ok } from "neverthrow";
import { formatRunExecuteError, runPlanSteps } from "../commands/run.js";
import { resolveDownloadDir } from "../core/fs.js";
import { planServiceResult } from "./plan-service.js";
import { nullReporter } from "./progress.js";
import type { ProgressReporter } from "./progress.js";
import type { RunResult, ServiceError } from "./types.js";

export type RunServiceOptions = {
  vars?: string[];
  llmCommand?: string;
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

  progress({ type: "info", message: `Running ${plan.steps.length} steps...` });

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
