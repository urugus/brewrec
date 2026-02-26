import { chromium } from "playwright";
import { loadRecipe } from "../core/recipe-store.js";

export async function debugCommand(name: string): Promise<void> {
  const recipe = await loadRecipe(name);
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    recordVideo: {
      dir: "artifacts",
      size: { width: 1280, height: 720 },
    },
  });
  const page = await context.newPage();

  for (const step of recipe.steps) {
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
}
