import { chromium } from "playwright";
import { loadRecipe } from "../core/recipe-store.js";
import { parseCliVariables, resolveRecipeStepTemplates } from "../core/template-vars.js";

type DebugOptions = {
  vars?: string[];
};

export async function debugCommand(name: string, options: DebugOptions): Promise<void> {
  const recipe = await loadRecipe(name);
  const variables = parseCliVariables(options.vars ?? []);
  const now = new Date();
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    recordVideo: {
      dir: "artifacts",
      size: { width: 1280, height: 720 },
    },
  });
  const page = await context.newPage();

  for (const step of recipe.steps) {
    const resolvedStep = resolveRecipeStepTemplates(step, { vars: variables, now });

    if (resolvedStep.action === "goto" && resolvedStep.url) {
      await page.goto(resolvedStep.url);
      continue;
    }
    if (resolvedStep.action === "click") {
      const selector = resolvedStep.selectorVariants?.[0];
      if (selector) await page.locator(selector).first().click();
      continue;
    }
    if (resolvedStep.action === "fill" && resolvedStep.value !== undefined) {
      const selector = resolvedStep.selectorVariants?.[0];
      if (selector) await page.locator(selector).first().fill(resolvedStep.value);
    }
  }

  await page.pause();
  await browser.close();
}
