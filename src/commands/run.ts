import { chromium, request } from "playwright";
import { loadRecipe } from "../core/recipe-store.js";
import type { RecipeStep } from "../types.js";

type RunOptions = {
  json?: boolean;
};

async function runPlaywrightSteps(steps: RecipeStep[]): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  for (const step of steps) {
    if (step.action === "goto" && step.url) {
      await page.goto(step.url, { waitUntil: "domcontentloaded" });
      continue;
    }

    if (step.action === "click") {
      for (const selector of step.selectorVariants ?? []) {
        try {
          await page.locator(selector).first().click({ timeout: 1200 });
          break;
        } catch {
          // fallback candidates
        }
      }
      continue;
    }

    if (step.action === "fill" && step.value !== undefined) {
      for (const selector of step.selectorVariants ?? []) {
        try {
          await page.locator(selector).first().fill(step.value, { timeout: 1200 });
          break;
        } catch {
          // fallback candidates
        }
      }
      continue;
    }

    if (step.action === "press" && step.key) {
      await page.keyboard.press(step.key);
    }
  }

  await browser.close();
}

async function runHttpSteps(steps: RecipeStep[]): Promise<void> {
  if (steps.length === 0) return;

  const context = await request.newContext();
  for (const step of steps) {
    if (step.action !== "fetch" || !step.url) continue;
    await context.get(step.url, { timeout: 5000 });
  }
  await context.dispose();
}

export async function runCommand(name: string, options: RunOptions): Promise<void> {
  const recipe = await loadRecipe(name);
  const httpSteps = recipe.steps.filter((s) => s.mode === "http");
  const pwSteps = recipe.steps.filter((s) => s.mode === "pw");

  await runHttpSteps(httpSteps);
  await runPlaywrightSteps(pwSteps);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ name, version: recipe.version, ok: true })}\n`);
  }
}
