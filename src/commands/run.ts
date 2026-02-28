import path from "node:path";
import { chromium, request } from "playwright";
import type { APIRequestContext, BrowserContext, Page } from "playwright";

type RuntimeStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
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
  /** Phase 1: stepId -> new selectors to prepend (from healer, no resolved template values) */
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

const settleAfterAction = async (page: Page): Promise<void> => {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 2000 });
  } catch {
    // noop
  }
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
    await settleAfterAction(page);
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
    await settleAfterAction(page);
    const newUrl = page.url();
    await assertEffects(step, { beforeUrl, currentUrl: newUrl, page });
    return newUrl;
  }

  if (step.action === "press" && step.key) {
    await page.keyboard.press(step.key);
    await settleAfterAction(page);
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

const runHttpStep = async (
  context: APIRequestContext,
  step: RecipeStep,
  guardUrl: string | undefined,
  beforeUrl: string | undefined,
  heal?: boolean,
): Promise<string | undefined> => {
  try {
    await assertGuards(step, { currentUrl: guardUrl });
  } catch {
    if (heal && canSkipGuardForHttp(step, guardUrl)) {
      logGuardSkipped(step.guards?.find((g) => g.type === "url_is")?.value ?? "", guardUrl ?? "");
    } else {
      throw new Error(
        `Guard failed: ${step.guards?.map((g) => `${g.type}=${g.value}`).join(", ")} (step=${step.id})`,
      );
    }
  }

  if (step.action !== "fetch" || !step.url) return beforeUrl;

  const response = await context.get(step.url, { timeout: 5000 });
  const responseUrl = response.url();
  await assertEffects(step, { beforeUrl, currentUrl: responseUrl });
  return responseUrl;
};

const executePwStepWithHeal = async (
  page: Page,
  step: RecipeStep,
  currentUrl: string | undefined,
  llmCommand: string,
): Promise<{
  currentUrl: string | undefined;
  healed: boolean;
  patchSelectors?: string[];
}> => {
  try {
    await assertGuards(step, { currentUrl: currentUrl ?? page.url(), page });
    const newUrl = await executeStep(page, step, currentUrl);
    return { currentUrl: newUrl, healed: false };
  } catch (err) {
    const errorMsg = (err as Error).message;

    if (errorMsg.startsWith("Guard failed:")) {
      const healed = await tryGuardWithHeal(step, currentUrl ?? page.url(), page);
      if (healed) {
        logGuardSkipped(
          step.guards?.find((g) => g.type === "url_is")?.value ?? "",
          currentUrl ?? page.url(),
        );
        const newUrl = await executeStep(page, step, currentUrl);
        return { currentUrl: newUrl, healed: false };
      }
    }

    if (step.action !== "click" && step.action !== "fill") {
      throw err;
    }

    logHealPhase1Start();
    const healResult = await healSelector(page, step, llmCommand);
    if (!healResult.healed) {
      logHealPhase1Failed();
      throw err;
    }

    logHealPhase1Success(healResult.strategy, healResult.newSelectors[0]);
    const patchedStep: RecipeStep = {
      ...step,
      selectorVariants: [...healResult.newSelectors, ...(step.selectorVariants ?? [])],
    };
    const newUrl = await executeStep(page, patchedStep, currentUrl);
    return { currentUrl: newUrl, healed: true, patchSelectors: healResult.newSelectors };
  }
};

const runPlanSteps = async (
  steps: RecipeStep[],
  downloadDir: string,
): Promise<string | undefined> => {
  const hasPwStep = steps.some((step) => step.mode === "pw");
  const browser = hasPwStep ? await chromium.launch({ headless: true }) : null;
  const pwContext = browser ? await browser.newContext({ acceptDownloads: true }) : null;
  const page = pwContext ? await pwContext.newPage() : null;
  let httpContext: APIRequestContext | undefined;
  if (page) {
    setupDownloadHandler(page, downloadDir);
  }

  try {
    let pageUrl: string | undefined;
    let httpUrl: string | undefined;
    let previousStepMode: RecipeStep["mode"] | undefined;
    for (const step of steps) {
      if (step.mode === "pw") {
        if (!page) {
          throw new Error(`Playwright page is not available for step ${step.id}`);
        }
        if (httpContext) {
          await httpContext.dispose();
          httpContext = undefined;
        }
        await assertGuards(step, { currentUrl: pageUrl ?? page.url(), page });
        pageUrl = await executeStep(page, step, pageUrl);
        previousStepMode = "pw";
        continue;
      }

      if (!httpContext || previousStepMode !== "http") {
        if (httpContext) {
          await httpContext.dispose();
        }
        const maybeStorage = pwContext ? await pwContext.storageState() : undefined;
        httpContext = await request.newContext(
          maybeStorage ? { storageState: maybeStorage } : undefined,
        );
      }
      httpUrl = await runHttpStep(httpContext, step, pageUrl ?? httpUrl, httpUrl ?? pageUrl);
      previousStepMode = "http";
    }

    return pageUrl ?? httpUrl ?? page?.url();
  } finally {
    if (httpContext) {
      await httpContext.dispose();
    }
    if (browser) {
      await browser.close();
    }
  }
};

const runPlanStepsWithHeal = async (
  steps: RecipeStep[],
  llmCommand: string,
  downloadDir: string,
): Promise<HealRunResult> => {
  const healStats: HealStats = { phase1Healed: 0, phase2ReRecorded: 0 };
  const selectorPatches = new Map<string, string[]>();
  let phase2Replacement: HealRunResult["phase2Replacement"] = null;

  const hasPwStep = steps.some((step) => step.mode === "pw");
  const browser = hasPwStep ? await chromium.launch({ headless: false }) : null;
  const context = browser ? await browser.newContext({ acceptDownloads: true }) : null;
  const page = context ? await context.newPage() : null;
  let httpContext: APIRequestContext | undefined;

  try {
    const healRecordBuffer: RecordedEvent[] = [];
    let isRecording = false;
    if (context) {
      await injectRecordingCapabilities(context, async (_page, event) => {
        if (isRecording) healRecordBuffer.push(event);
      });
    }
    if (page) {
      setupDownloadHandler(page, downloadDir);
    }

    let pageUrl: string | undefined;
    let httpUrl: string | undefined;
    let previousStepMode: RecipeStep["mode"] | undefined;

    for (const step of steps) {
      logStepStart(step.id, step.title);

      if (step.mode === "http") {
        try {
          if (!httpContext || previousStepMode !== "http") {
            if (httpContext) {
              await httpContext.dispose();
            }
            const maybeStorage = context ? await context.storageState() : undefined;
            httpContext = await request.newContext(
              maybeStorage ? { storageState: maybeStorage } : undefined,
            );
          }
          httpUrl = await runHttpStep(
            httpContext,
            step,
            pageUrl ?? httpUrl,
            httpUrl ?? pageUrl,
            true,
          );
          previousStepMode = "http";
          logStepOk();
          continue;
        } catch (err) {
          logStepFailed((err as Error).message);
          throw err;
        }
      }

      if (!page) {
        const noPageErr = new Error(`Playwright page is not available for step ${step.id}`);
        logStepFailed(noPageErr.message);
        throw noPageErr;
      }

      try {
        if (httpContext) {
          await httpContext.dispose();
          httpContext = undefined;
        }
        const result = await executePwStepWithHeal(page, step, pageUrl, llmCommand);
        pageUrl = result.currentUrl;
        if (result.healed && result.patchSelectors) {
          selectorPatches.set(step.id, result.patchSelectors);
          healStats.phase1Healed++;
        }
        previousStepMode = "pw";
        logStepOk();
      } catch (err) {
        logStepFailed((err as Error).message);

        logHealPhase2Start(step.title);
        healRecordBuffer.length = 0;
        isRecording = true;

        await waitForEnter();

        isRecording = false;

        if (healRecordBuffer.length === 0) {
          throw new Error(`Healing failed for step ${step.id}: no user actions recorded`);
        }

        const userEvents = healRecordBuffer.filter(
          (e) =>
            e.type === "click" ||
            e.type === "input" ||
            e.type === "navigation" ||
            e.type === "keypress",
        );
        const newSteps = eventsToSteps(userEvents);
        if (newSteps.length === 0) {
          throw new Error(`Healing failed for step ${step.id}: no executable steps recorded`);
        }
        const reNumberedSteps = newSteps.map((s, idx) => ({
          ...s,
          id: `${step.id}-healed-${idx + 1}`,
        }));

        logHealPhase2Success(reNumberedSteps.length);

        phase2Replacement = {
          replacedFromStepId: step.id,
          newSteps: reNumberedSteps,
        };
        healStats.phase2ReRecorded++;

        for (const newStep of reNumberedSteps) {
          logStepStart(newStep.id, newStep.title);
          try {
            if (newStep.mode === "http") {
              if (!httpContext || previousStepMode !== "http") {
                if (httpContext) {
                  await httpContext.dispose();
                }
                const maybeStorage = context ? await context.storageState() : undefined;
                httpContext = await request.newContext(
                  maybeStorage ? { storageState: maybeStorage } : undefined,
                );
              }
              httpUrl = await runHttpStep(
                httpContext,
                newStep,
                pageUrl ?? httpUrl,
                httpUrl ?? pageUrl,
                true,
              );
              previousStepMode = "http";
            } else {
              if (httpContext) {
                await httpContext.dispose();
                httpContext = undefined;
              }
              pageUrl = await executeStep(page, newStep, pageUrl);
              previousStepMode = "pw";
            }
            logStepOk();
          } catch (reErr) {
            logStepFailed((reErr as Error).message);
            throw new Error(`Re-recorded step ${newStep.id} failed: ${(reErr as Error).message}`);
          }
        }

        break;
      }
    }

    return {
      lastUrl: pageUrl ?? httpUrl ?? page?.url(),
      healStats,
      selectorPatches,
      phase2Replacement,
    };
  } finally {
    if (httpContext) {
      await httpContext.dispose();
    }
    if (browser) {
      await browser.close();
    }
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

  const downloadDir = await resolveDownloadDir(name, recipe.downloadDir);

  if (options.heal) {
    const result = await runPlanStepsWithHeal(
      plan.steps,
      options.llmCommand ?? "claude",
      downloadDir,
    );

    const { healStats, selectorPatches, phase2Replacement } = result;
    if (healStats.phase1Healed > 0 || healStats.phase2ReRecorded > 0) {
      let mergedSteps = recipe.steps.map((s) => {
        const newSelectors = selectorPatches.get(s.id);
        if (newSelectors) {
          return { ...s, selectorVariants: [...newSelectors, ...(s.selectorVariants ?? [])] };
        }
        return s;
      });

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
    await runPlanSteps(plan.steps, downloadDir);
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
