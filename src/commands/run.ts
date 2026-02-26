import { chromium, request } from "playwright";
import { loadRecipe } from "../core/recipe-store.js";
import { assertEffects, assertGuards } from "../core/step-validation.js";
import { parseCliVariables, resolveRecipeStepTemplates } from "../core/template-vars.js";
import type { RecipeStep } from "../types.js";

type RunOptions = {
  json?: boolean;
  vars?: string[];
};

async function tryClick(page: import("playwright").Page, selectors: string[]): Promise<void> {
  for (const selector of selectors) {
    try {
      await page.locator(selector).first().click({ timeout: 1200 });
      return;
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Click failed for selectors: ${selectors.join(", ")}`);
}

async function tryFill(
  page: import("playwright").Page,
  selectors: string[],
  value: string,
): Promise<void> {
  for (const selector of selectors) {
    try {
      await page.locator(selector).first().fill(value, { timeout: 1200 });
      return;
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Fill failed for selectors: ${selectors.join(", ")}`);
}

async function runPlaywrightSteps(
  steps: RecipeStep[],
  variables: Record<string, string>,
  now: Date,
): Promise<string | undefined> {
  if (steps.length === 0) return undefined;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let currentUrl: string | undefined;

    for (const step of steps) {
      const resolvedStep = resolveRecipeStepTemplates(step, { vars: variables, now });
      await assertGuards(resolvedStep, { currentUrl: currentUrl ?? page.url(), page });

      const beforeUrl = currentUrl ?? page.url();

      if (resolvedStep.action === "goto" && resolvedStep.url) {
        await page.goto(resolvedStep.url, { waitUntil: "domcontentloaded" });
        currentUrl = page.url();
        await assertEffects(resolvedStep, { beforeUrl, currentUrl, page });
        continue;
      }

      if (resolvedStep.action === "click") {
        const selectors = resolvedStep.selectorVariants ?? [];
        if (selectors.length === 0) {
          throw new Error(`No selectorVariants for click step: ${resolvedStep.id}`);
        }
        await tryClick(page, selectors);
        currentUrl = page.url();
        await assertEffects(resolvedStep, { beforeUrl, currentUrl, page });
        continue;
      }

      if (resolvedStep.action === "fill" && resolvedStep.value !== undefined) {
        const selectors = resolvedStep.selectorVariants ?? [];
        if (selectors.length === 0) {
          throw new Error(`No selectorVariants for fill step: ${resolvedStep.id}`);
        }
        await tryFill(page, selectors, resolvedStep.value);
        currentUrl = page.url();
        await assertEffects(resolvedStep, { beforeUrl, currentUrl, page });
        continue;
      }

      if (resolvedStep.action === "press" && resolvedStep.key) {
        await page.keyboard.press(resolvedStep.key);
        currentUrl = page.url();
        await assertEffects(resolvedStep, { beforeUrl, currentUrl, page });
      }
    }

    return currentUrl ?? page.url();
  } finally {
    await browser.close();
  }
}

async function runHttpSteps(
  steps: RecipeStep[],
  variables: Record<string, string>,
  now: Date,
  currentUrlFromPw?: string,
): Promise<string | undefined> {
  if (steps.length === 0) return currentUrlFromPw;

  const context = await request.newContext();
  try {
    let lastFetchedUrl = currentUrlFromPw;

    for (const step of steps) {
      const resolvedStep = resolveRecipeStepTemplates(step, { vars: variables, now });
      await assertGuards(resolvedStep, { currentUrl: lastFetchedUrl });

      if (resolvedStep.action !== "fetch" || !resolvedStep.url) continue;
      const response = await context.get(resolvedStep.url, { timeout: 5000 });
      const responseUrl = response.url();
      await assertEffects(resolvedStep, { beforeUrl: lastFetchedUrl, currentUrl: responseUrl });
      lastFetchedUrl = responseUrl;
    }

    return lastFetchedUrl;
  } finally {
    await context.dispose();
  }
}

export async function runCommand(name: string, options: RunOptions): Promise<void> {
  const recipe = await loadRecipe(name);
  const httpSteps = recipe.steps.filter((s) => s.mode === "http");
  const pwSteps = recipe.steps.filter((s) => s.mode === "pw");
  const variables = parseCliVariables(options.vars ?? []);
  const now = new Date();

  const lastPwUrl = await runPlaywrightSteps(pwSteps, variables, now);
  await runHttpSteps(httpSteps, variables, now, lastPwUrl);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ name, version: recipe.version, ok: true })}\n`);
  }
}
