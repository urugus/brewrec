import path from "node:path";
import { chromium } from "playwright";
import { buildExecutionPlan } from "../core/execution-plan.js";
import { resolveDownloadDir } from "../core/fs.js";
import { loadRecipe } from "../core/recipe-store.js";
import { parseCliVariables } from "../core/template-vars.js";

type DebugOptions = {
  vars?: string[];
  llmCommand?: string;
};

export const debugCommand = async (name: string, options: DebugOptions): Promise<void> => {
  const recipe = await loadRecipe(name);
  const plan = await buildExecutionPlan(recipe, {
    cliVars: parseCliVariables(options.vars ?? []),
    llmCommand: options.llmCommand,
  });
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
};
