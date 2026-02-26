import { chromium, request } from "playwright";
import { buildExecutionPlan } from "../core/execution-plan.js";
import { loadRecipe } from "../core/recipe-store.js";
import { assertEffects, assertGuards } from "../core/step-validation.js";
import { parseCliVariables } from "../core/template-vars.js";
import type { RecipeStep } from "../types.js";

type RunOptions = {
  json?: boolean;
  vars?: string[];
  llmCommand?: string;
  planOnly?: boolean;
};

const tryClick = async (page: import("playwright").Page, selectors: string[]): Promise<void> => {
  for (const selector of selectors) {
    try {
      await page.locator(selector).first().click({ timeout: 1200 });
      return;
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Click failed for selectors: ${selectors.join(", ")}`);
};

const tryFill = async (
  page: import("playwright").Page,
  selectors: string[],
  value: string,
): Promise<void> => {
  for (const selector of selectors) {
    try {
      await page.locator(selector).first().fill(value, { timeout: 1200 });
      return;
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Fill failed for selectors: ${selectors.join(", ")}`);
};

const runPlaywrightSteps = async (steps: RecipeStep[]): Promise<string | undefined> => {
  if (steps.length === 0) return undefined;

  const browser = await chromium.launch({ headless: true });
  try {
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

    return currentUrl ?? page.url();
  } finally {
    await browser.close();
  }
};

const runHttpSteps = async (
  steps: RecipeStep[],
  currentUrlFromPw?: string,
): Promise<string | undefined> => {
  if (steps.length === 0) return currentUrlFromPw;

  const context = await request.newContext();
  try {
    let lastFetchedUrl = currentUrlFromPw;

    for (const step of steps) {
      await assertGuards(step, { currentUrl: lastFetchedUrl });

      if (step.action !== "fetch" || !step.url) continue;
      const response = await context.get(step.url, { timeout: 5000 });
      const responseUrl = response.url();
      await assertEffects(step, { beforeUrl: lastFetchedUrl, currentUrl: responseUrl });
      lastFetchedUrl = responseUrl;
    }

    return lastFetchedUrl;
  } finally {
    await context.dispose();
  }
};

export const runCommand = async (name: string, options: RunOptions): Promise<void> => {
  const recipe = await loadRecipe(name);
  const plan = await buildExecutionPlan(recipe, {
    cliVars: parseCliVariables(options.vars ?? []),
    llmCommand: options.llmCommand,
  });

  if (plan.unresolvedVars.length > 0) {
    const message = `Unresolved variables: ${plan.unresolvedVars.join(", ")}`;
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ name, version: recipe.version, ok: false, phase: "plan", ...plan })}\n`,
      );
    }
    throw new Error(message);
  }

  if (options.planOnly) {
    process.stdout.write(
      `${JSON.stringify({ name, version: recipe.version, ok: true, phase: "plan", ...plan })}\n`,
    );
    return;
  }

  const httpSteps = plan.steps.filter((s) => s.mode === "http");
  const pwSteps = plan.steps.filter((s) => s.mode === "pw");

  const lastPwUrl = await runPlaywrightSteps(pwSteps);
  await runHttpSteps(httpSteps, lastPwUrl);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        name,
        version: recipe.version,
        ok: true,
        phase: "execute",
        resolvedVars: plan.resolvedVars,
        warnings: plan.warnings,
      })}\n`,
    );
  }
};
