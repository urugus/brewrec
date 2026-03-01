import path from "node:path";
import { type Result, err, ok } from "neverthrow";
import { chromium } from "playwright";
import { buildExecutionPlanResult, formatBuildExecutionPlanError } from "../core/execution-plan.js";
import { resolveDownloadDir } from "../core/fs.js";
import { formatRecipeStoreError, loadRecipeResult } from "../core/recipe-store.js";
import { formatTemplateVarError, parseCliVariablesResult } from "../core/template-vars.js";
import type { CommandError } from "./result.js";
import { toCommandError } from "./result.js";

type DebugOptions = {
  vars?: string[];
  llmCommand?: string;
};

export const debugCommand = async (name: string, options: DebugOptions): Promise<void> => {
  const result = await debugCommandResult(name, options);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
};

export const debugCommandResult = async (
  name: string,
  options: DebugOptions,
): Promise<Result<void, CommandError>> => {
  try {
    const recipeResult = await loadRecipeResult(name);
    if (recipeResult.isErr()) {
      throw new Error(formatRecipeStoreError(recipeResult.error));
    }
    const recipe = recipeResult.value;
    const cliVarsResult = parseCliVariablesResult(options.vars ?? []);
    if (cliVarsResult.isErr()) {
      throw new Error(formatTemplateVarError(cliVarsResult.error));
    }

    const planResult = await buildExecutionPlanResult(recipe, {
      cliVars: cliVarsResult.value,
      llmCommand: options.llmCommand,
    });
    if (planResult.isErr()) {
      throw new Error(formatBuildExecutionPlanError(planResult.error));
    }
    const plan = planResult.value;

    if (plan.unresolvedVars.length > 0) {
      throw new Error(`Unresolved variables: ${plan.unresolvedVars.join(", ")}`);
    }

    const downloadDir = await resolveDownloadDir(name, recipe.downloadDir);

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      acceptDownloads: true,
      recordVideo: {
        dir: "artifacts",
        size: { width: 1280, height: 720 },
      },
    });
    const page = await context.newPage();
    page.on("download", async (download) => {
      const savePath = path.join(downloadDir, download.suggestedFilename());
      await download.saveAs(savePath);
      process.stderr.write(`  Downloaded: ${savePath}\n`);
    });

    for (const step of plan.steps) {
      if (step.action === "goto" && step.url) {
        await page.goto(step.url);
        continue;
      }
      if (step.action === "click") {
        const selector = step.selectorVariants?.[0];
        if (selector) await page.locator(selector).first().click();
        continue;
      }
      if (step.action === "fill" && step.value !== undefined) {
        const selector = step.selectorVariants?.[0];
        if (selector) await page.locator(selector).first().fill(step.value);
      }
    }

    await page.pause();
    await browser.close();
    return ok(undefined);
  } catch (cause) {
    return err(toCommandError("debug", cause));
  }
};
