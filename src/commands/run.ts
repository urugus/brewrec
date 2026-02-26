import { chromium, request } from "playwright";
import { loadRecipe } from "../core/recipe-store.js";
import { assertEffects, assertGuards } from "../core/step-validation.js";
import type { RecipeStep } from "../types.js";

type RunOptions = {
  json?: boolean;
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

async function runPlaywrightSteps(steps: RecipeStep[]): Promise<string | undefined> {
  if (steps.length === 0) return undefined;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  let currentUrl: string | undefined;

  for (const step of steps) {
    await assertGuards(step, { currentUrl: currentUrl ?? page.url(), page });

    const beforeUrl = currentUrl ?? page.url();

    if (step.action === "goto" && step.url) {
      await page.goto(step.url, { waitUntil: "domcontentloaded" });
      currentUrl = page.url();
      await assertEffects(step, { beforeUrl, currentUrl, page });
      continue;
    }

    if (step.action === "click") {
      const selectors = step.selectorVariants ?? [];
      if (selectors.length === 0) {
        throw new Error(`No selectorVariants for click step: ${step.id}`);
      }
      await tryClick(page, selectors);
      currentUrl = page.url();
      await assertEffects(step, { beforeUrl, currentUrl, page });
      continue;
    }

    if (step.action === "fill" && step.value !== undefined) {
      const selectors = step.selectorVariants ?? [];
      if (selectors.length === 0) {
        throw new Error(`No selectorVariants for fill step: ${step.id}`);
      }
      await tryFill(page, selectors, step.value);
      currentUrl = page.url();
      await assertEffects(step, { beforeUrl, currentUrl, page });
      continue;
    }

    if (step.action === "press" && step.key) {
      await page.keyboard.press(step.key);
      currentUrl = page.url();
      await assertEffects(step, { beforeUrl, currentUrl, page });
    }
  }

  const lastUrl = currentUrl ?? page.url();
  await browser.close();
  return lastUrl;
}

async function runHttpSteps(
  steps: RecipeStep[],
  currentUrlFromPw?: string,
): Promise<string | undefined> {
  if (steps.length === 0) return currentUrlFromPw;

  const context = await request.newContext();
  const guardUrl = currentUrlFromPw;
  let lastFetchedUrl = currentUrlFromPw;

  for (const step of steps) {
    await assertGuards(step, { currentUrl: guardUrl });

    if (step.action !== "fetch" || !step.url) continue;
    const response = await context.get(step.url, { timeout: 5000 });
    const responseUrl = response.url();
    await assertEffects(step, { beforeUrl: lastFetchedUrl, currentUrl: responseUrl });
    lastFetchedUrl = responseUrl;
  }

  await context.dispose();
  return lastFetchedUrl;
}

export async function runCommand(name: string, options: RunOptions): Promise<void> {
  const recipe = await loadRecipe(name);
  const httpSteps = recipe.steps.filter((s) => s.mode === "http");
  const pwSteps = recipe.steps.filter((s) => s.mode === "pw");

  const lastPwUrl = await runPlaywrightSteps(pwSteps);
  await runHttpSteps(httpSteps, lastPwUrl);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ name, version: recipe.version, ok: true })}\n`);
  }
}
