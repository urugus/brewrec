import path from "node:path";
import { chromium, request } from "playwright";
import type { BrowserContext, Page } from "playwright";
import { eventsToSteps } from "../core/compile-heuristic.js";
import { buildExecutionPlan } from "../core/execution-plan.js";
import { resolveDownloadDir } from "../core/fs.js";
import {
  logGuardSkipped,
  logHealPhase1Failed,
  logHealPhase1Start,
  logHealPhase1Success,
  logHealPhase2Start,
  logHealPhase2Success,
  logHealSummary,
  logRecipeSaved,
  logStepFailed,
  logStepOk,
  logStepStart,
} from "../core/heal-logger.js";
import { injectRecordingCapabilities } from "../core/init-script.js";
import { loadRecipe, saveRecipe } from "../core/recipe-store.js";
import { healSelector } from "../core/selector-healer.js";
import { assertEffects, assertGuards } from "../core/step-validation.js";
import { parseCliVariables } from "../core/template-vars.js";
import type { Recipe, RecipeStep, RecordedEvent } from "../types.js";

type RunOptions = {
  json?: boolean;
  vars?: string[];
  llmCommand?: string;
  planOnly?: boolean;
  heal?: boolean;
};

type HealStats = {
  phase1Healed: number;
  phase2ReRecorded: number;
};

type HealRunResult = {
  lastUrl: string | undefined;
  healStats: HealStats;
  /** Phase 1: stepId → new selectors to prepend (from healer, no resolved template values) */
  selectorPatches: Map<string, string[]>;
  /** Phase 2: tracks which step triggered re-record and the newly generated steps */
  phase2Replacement: {
    replacedFromStepId: string;
    newSteps: RecipeStep[];
  } | null;
};

const tryClick = async (page: Page, selectors: string[]): Promise<void> => {
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

const tryFill = async (page: Page, selectors: string[], value: string): Promise<void> => {
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

const tryGuardWithHeal = async (
  step: RecipeStep,
  currentUrl: string,
  page: Page,
): Promise<boolean> => {
  for (const guard of step.guards ?? []) {
    if (guard.type === "url_is") {
      try {
        const expected = new URL(guard.value);
        const actual = new URL(currentUrl);
        if (expected.hostname === actual.hostname) {
          logGuardSkipped(guard.value, currentUrl);
          return true;
        }
      } catch {
        process.stderr.write(
          `    -> [Guard修復] URLパース失敗: guard=${guard.value}, current=${currentUrl}\n`,
        );
      }
      return false;
    }

    if (guard.type === "text_visible") {
      try {
        await page.getByText(guard.value).first().waitFor({ timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
};

const waitForEnter = (): Promise<void> => {
  return new Promise((resolve) => {
    const wasRaw = process.stdin.isRaw ?? false;
    const onData = () => {
      process.stdin.removeListener("data", onData);
      if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      resolve();
    };
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
};

const executeStep = async (
  page: Page,
  step: RecipeStep,
  currentUrl: string | undefined,
): Promise<string> => {
  const beforeUrl = currentUrl ?? page.url();

  if (step.action === "goto" && step.url) {
    await page.goto(step.url, { waitUntil: "domcontentloaded" });
    const newUrl = page.url();
    await assertEffects(step, { beforeUrl, currentUrl: newUrl, page });
    return newUrl;
  }

  if (step.action === "click") {
    const selectors = step.selectorVariants ?? [];
    if (selectors.length === 0) {
      throw new Error(`No selectorVariants for click step: ${step.id}`);
    }
    await tryClick(page, selectors);
    const newUrl = page.url();
    await assertEffects(step, { beforeUrl, currentUrl: newUrl, page });
    return newUrl;
  }

  if (step.action === "fill" && step.value !== undefined) {
    const selectors = step.selectorVariants ?? [];
    if (selectors.length === 0) {
      throw new Error(`No selectorVariants for fill step: ${step.id}`);
    }
    await tryFill(page, selectors, step.value);
    const newUrl = page.url();
    await assertEffects(step, { beforeUrl, currentUrl: newUrl, page });
    return newUrl;
  }

  if (step.action === "press" && step.key) {
    await page.keyboard.press(step.key);
    const newUrl = page.url();
    await assertEffects(step, { beforeUrl, currentUrl: newUrl, page });
    return newUrl;
  }

  return currentUrl ?? page.url();
};

const setupDownloadHandler = (page: Page, downloadDir: string): void => {
  page.on("download", async (download) => {
    const filename = download.suggestedFilename();
    const savePath = path.join(downloadDir, filename);
    await download.saveAs(savePath);
    process.stderr.write(`  Downloaded: ${savePath}\n`);
  });
};

const runPlaywrightSteps = async (
  steps: RecipeStep[],
  downloadDir: string,
): Promise<string | undefined> => {
  if (steps.length === 0) return undefined;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    setupDownloadHandler(page, downloadDir);
    let currentUrl: string | undefined;

    for (const step of steps) {
      await assertGuards(step, { currentUrl: currentUrl ?? page.url(), page });
      currentUrl = await executeStep(page, step, currentUrl);
    }

    return currentUrl ?? page.url();
  } finally {
    await browser.close();
  }
};

const runPlaywrightStepsWithHeal = async (
  steps: RecipeStep[],
  llmCommand: string,
  downloadDir: string,
): Promise<HealRunResult> => {
  const healStats: HealStats = { phase1Healed: 0, phase2ReRecorded: 0 };
  const selectorPatches = new Map<string, string[]>();
  let phase2Replacement: HealRunResult["phase2Replacement"] = null;
  const runnableSteps = [...steps];

  if (steps.length === 0) {
    return { lastUrl: undefined, healStats, selectorPatches, phase2Replacement };
  }

  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({ acceptDownloads: true });

    // Pre-inject recording capabilities for Phase 2
    const healRecordBuffer: RecordedEvent[] = [];
    let isRecording = false;
    await injectRecordingCapabilities(context, async (_page, event) => {
      if (isRecording) healRecordBuffer.push(event);
    });

    const page = await context.newPage();
    setupDownloadHandler(page, downloadDir);
    let currentUrl: string | undefined;

    for (let i = 0; i < runnableSteps.length; i++) {
      const step = runnableSteps[i];
      logStepStart(step.id, step.title);

      try {
        await assertGuards(step, { currentUrl: currentUrl ?? page.url(), page });
        currentUrl = await executeStep(page, step, currentUrl);
        logStepOk();
      } catch (err) {
        const errorMsg = (err as Error).message;

        // Guard failure: try domain-match heal
        if (errorMsg.startsWith("Guard failed:")) {
          const healed = await tryGuardWithHeal(step, currentUrl ?? page.url(), page);
          if (healed) {
            logGuardSkipped(
              step.guards?.find((g) => g.type === "url_is")?.value ?? "",
              currentUrl ?? page.url(),
            );
            try {
              currentUrl = await executeStep(page, step, currentUrl);
              logStepOk();
              continue;
            } catch {
              // Guard heal succeeded but action still failed, fall through
            }
          }
        }

        logStepFailed(errorMsg);

        // Phase 1: selector auto-heal (heuristic + Claude LLM)
        if (step.action === "click" || step.action === "fill") {
          logHealPhase1Start();
          const healResult = await healSelector(page, step, llmCommand);

          if (healResult.healed) {
            logHealPhase1Success(healResult.strategy, healResult.newSelectors[0]);
            const patchedStep: RecipeStep = {
              ...step,
              selectorVariants: [...healResult.newSelectors, ...(step.selectorVariants ?? [])],
            };
            try {
              currentUrl = await executeStep(page, patchedStep, currentUrl);
              runnableSteps[i] = patchedStep;
              selectorPatches.set(step.id, healResult.newSelectors);
              healStats.phase1Healed++;
              logStepOk();
              continue;
            } catch {
              // healed selector found element but action still failed
            }
          }

          logHealPhase1Failed();
        }

        // Phase 2: manual re-record fallback
        logHealPhase2Start(step.title);
        healRecordBuffer.length = 0;
        isRecording = true;

        await waitForEnter();

        isRecording = false;

        if (healRecordBuffer.length === 0) {
          throw new Error(`Healing failed for step ${step.id}: no user actions recorded`);
        }

        // Convert recorded events to steps
        const userEvents = healRecordBuffer.filter(
          (e) =>
            e.type === "click" ||
            e.type === "input" ||
            e.type === "navigation" ||
            e.type === "keypress",
        );
        const newSteps = eventsToSteps(userEvents);
        const reNumberedSteps = newSteps.map((s, idx) => ({
          ...s,
          id: `${step.id}-healed-${idx + 1}`,
        }));

        logHealPhase2Success(reNumberedSteps.length);

        // Track replacement for recipe save (uses original step IDs, no resolved values)
        phase2Replacement = {
          replacedFromStepId: step.id,
          newSteps: reNumberedSteps,
        };
        healStats.phase2ReRecorded++;

        // Execute the newly recorded steps
        for (const newStep of reNumberedSteps) {
          logStepStart(newStep.id, newStep.title);
          try {
            await assertGuards(newStep, { currentUrl: currentUrl ?? page.url(), page });
            currentUrl = await executeStep(page, newStep, currentUrl);
            logStepOk();
          } catch (reErr) {
            logStepFailed((reErr as Error).message);
            throw new Error(`Re-recorded step ${newStep.id} failed: ${(reErr as Error).message}`);
          }
        }

        break; // All remaining steps were re-recorded and executed
      }
    }

    return { lastUrl: currentUrl ?? page.url(), healStats, selectorPatches, phase2Replacement };
  } finally {
    await browser.close();
  }
};

const canSkipGuardForHttp = (step: RecipeStep, currentUrl: string | undefined): boolean => {
  if (!currentUrl) return false;
  for (const guard of step.guards ?? []) {
    if (guard.type === "url_is") {
      try {
        const expected = new URL(guard.value);
        const actual = new URL(currentUrl);
        if (expected.hostname === actual.hostname) return true;
      } catch {
        // invalid URL
      }
    }
  }
  return false;
};

const runHttpSteps = async (
  steps: RecipeStep[],
  currentUrlFromPw?: string,
  heal?: boolean,
): Promise<string | undefined> => {
  if (steps.length === 0) return currentUrlFromPw;

  const context = await request.newContext();
  try {
    let lastFetchedUrl = currentUrlFromPw;

    for (const step of steps) {
      try {
        await assertGuards(step, { currentUrl: lastFetchedUrl });
      } catch {
        if (heal && canSkipGuardForHttp(step, lastFetchedUrl)) {
          logGuardSkipped(
            step.guards?.find((g) => g.type === "url_is")?.value ?? "",
            lastFetchedUrl ?? "",
          );
        } else {
          throw new Error(
            `Guard failed: ${step.guards?.map((g) => `${g.type}=${g.value}`).join(", ")} (step=${step.id})`,
          );
        }
      }

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
  const downloadDir = await resolveDownloadDir(name, recipe.downloadDir);

  if (options.heal) {
    const result = await runPlaywrightStepsWithHeal(
      pwSteps,
      options.llmCommand ?? "claude",
      downloadDir,
    );
    await runHttpSteps(httpSteps, result.lastUrl, true);

    // Save healed recipe if any healing occurred
    const { healStats, selectorPatches, phase2Replacement } = result;
    if (healStats.phase1Healed > 0 || healStats.phase2ReRecorded > 0) {
      // Build merged steps from original recipe (template placeholders intact, no resolved secrets)
      let mergedSteps = recipe.steps.map((s) => {
        const newSelectors = selectorPatches.get(s.id);
        if (newSelectors) {
          return { ...s, selectorVariants: [...newSelectors, ...(s.selectorVariants ?? [])] };
        }
        return s;
      });

      // Phase 2: replace from the failed step onward with newly recorded steps
      if (phase2Replacement) {
        const idx = mergedSteps.findIndex((s) => s.id === phase2Replacement.replacedFromStepId);
        if (idx >= 0) {
          mergedSteps = [...mergedSteps.slice(0, idx), ...phase2Replacement.newSteps];
        }
      }

      const healed: Recipe = {
        ...recipe,
        version: recipe.version + 1,
        updatedAt: new Date().toISOString(),
        source: "healed",
        steps: mergedSteps,
        notes:
          `${recipe.notes ?? ""}\nSelf-healed: ${healStats.phase1Healed} auto-fixed, ${healStats.phase2ReRecorded} re-recorded.`.trim(),
      };
      await saveRecipe(healed);
      logRecipeSaved(name, healed.version);
      logHealSummary(healStats.phase1Healed, healStats.phase2ReRecorded);
    }
  } else {
    const lastPwUrl = await runPlaywrightSteps(pwSteps, downloadDir);
    await runHttpSteps(httpSteps, lastPwUrl);
  }

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
