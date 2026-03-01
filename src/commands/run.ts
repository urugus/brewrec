import fs from "node:fs/promises";
import path from "node:path";
import { type Result, err, ok } from "neverthrow";
import { chromium, request } from "playwright";
import type { APIRequestContext, BrowserContext, Page } from "playwright";
import {
  eventsToSteps,
  isDocumentDownload,
  normalizeHttpMethod,
} from "../core/compile-heuristic.js";
import { buildExecutionPlanResult, formatBuildExecutionPlanError } from "../core/execution-plan.js";
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
import {
  formatRecipeStoreError,
  loadRecipeResult,
  saveRecipeResult,
} from "../core/recipe-store.js";
import { healSelector } from "../core/selector-healer.js";
import {
  assertEffects,
  assertGuards,
  formatStepValidationError,
  matchesUrl,
  validateGuards,
} from "../core/step-validation.js";
import { formatTemplateVarError, parseCliVariablesResult } from "../core/template-vars.js";
import type { Recipe, RecipeStep, RecordedEvent } from "../types.js";
import type { CommandError } from "./result.js";
import { toCommandError } from "./result.js";

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
  phase2Replacements: Array<{
    replacedFromStepId: string;
    newSteps: RecipeStep[];
  }>;
};

type RunExecuteError =
  | {
      kind: "context_unavailable";
      stepId: string;
      message: string;
    }
  | {
      kind: "step_execution_failed";
      stepId: string;
      message: string;
    }
  | {
      kind: "heal_record_failed";
      stepId: string;
      message: string;
    }
  | {
      kind: "re_record_failed";
      stepId: string;
      reRecordedStepId: string;
      message: string;
    }
  | {
      kind: "unexpected_error";
      phase: "run" | "run_heal";
      message: string;
    };

const formatRunExecuteError = (error: RunExecuteError): string => {
  if (error.kind === "context_unavailable") {
    return error.message;
  }
  if (error.kind === "step_execution_failed") {
    return `Step ${error.stepId} failed: ${error.message}`;
  }
  if (error.kind === "heal_record_failed") {
    return `Healing failed for step ${error.stepId}: ${error.message}`;
  }
  if (error.kind === "re_record_failed") {
    return `Re-recorded step ${error.reRecordedStepId} failed: ${error.message}`;
  }
  return `Run execution failed (${error.phase}): ${error.message}`;
};

const causeMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  return String(cause);
};

const stepExecutionError = (stepId: string, message: string): RunExecuteError => ({
  kind: "step_execution_failed",
  stepId,
  message,
});

export const applyPhase2Replacements = (
  baseSteps: RecipeStep[],
  replacements: HealRunResult["phase2Replacements"],
): RecipeStep[] => {
  const mergedSteps = [...baseSteps];
  for (const replacement of replacements) {
    const idx = mergedSteps.findIndex((s) => s.id === replacement.replacedFromStepId);
    if (idx < 0) continue;
    mergedSteps.splice(idx, 1, ...replacement.newSteps);
  }
  return mergedSteps;
};

const tryClickResult = async (page: Page, selectors: string[]): Promise<Result<void, string>> => {
  for (const selector of selectors) {
    try {
      await page.locator(selector).first().click({ timeout: 1200 });
      return ok(undefined);
    } catch {
      // try next candidate
    }
  }

  return err(`Click failed for selectors: ${selectors.join(", ")}`);
};

const tryFillResult = async (
  page: Page,
  selectors: string[],
  value: string,
): Promise<Result<void, string>> => {
  for (const selector of selectors) {
    try {
      await page.locator(selector).first().fill(value, { timeout: 1200 });
      return ok(undefined);
    } catch {
      // try next candidate
    }
  }

  return err(`Fill failed for selectors: ${selectors.join(", ")}`);
};

const tryGuardWithHeal = async (
  step: RecipeStep,
  currentUrl: string,
  page: Page,
): Promise<boolean> => {
  const guards = step.guards ?? [];
  if (guards.length === 0) return false;

  for (const guard of guards) {
    if (guard.type === "url_is") {
      if (matchesUrl(guard.value, currentUrl)) continue;
      if (guardHostnameMatches(guard.value, currentUrl)) {
        logGuardSkipped(guard.value, currentUrl);
        continue;
      }
      if (!extractHostnameForGuardUrl(guard.value)) {
        process.stderr.write(
          `    -> [Guard修復] URLパース失敗: guard=${guard.value}, current=${currentUrl}\n`,
        );
      }
      return false;
    }

    if (guard.type === "url_not") {
      if (matchesUrl(guard.value, currentUrl)) return false;
      continue;
    }

    if (guard.type === "text_visible") {
      try {
        await page.getByText(guard.value).first().waitFor({ timeout: 5000 });
      } catch {
        return false;
      }
    }
  }

  return true;
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

const executeStepResult = async (
  page: Page,
  step: RecipeStep,
  currentUrl: string | undefined,
): Promise<Result<string, RunExecuteError>> => {
  const beforeUrl = currentUrl ?? page.url();

  try {
    if (step.action === "goto" && step.url) {
      await page.goto(step.url, { waitUntil: "domcontentloaded" });
      const newUrl = page.url();
      await assertEffects(step, { beforeUrl, currentUrl: newUrl, page });
      return ok(newUrl);
    }

    if (step.action === "click") {
      const selectors = step.selectorVariants ?? [];
      if (selectors.length === 0) {
        return err(stepExecutionError(step.id, `No selectorVariants for click step: ${step.id}`));
      }
      const clickResult = await tryClickResult(page, selectors);
      if (clickResult.isErr()) {
        return err(stepExecutionError(step.id, clickResult.error));
      }
      await settleAfterAction(page);
      const newUrl = page.url();
      await assertEffects(step, { beforeUrl, currentUrl: newUrl, page });
      return ok(newUrl);
    }

    if (step.action === "fill" && step.value !== undefined) {
      const selectors = step.selectorVariants ?? [];
      if (selectors.length === 0) {
        return err(stepExecutionError(step.id, `No selectorVariants for fill step: ${step.id}`));
      }
      const fillResult = await tryFillResult(page, selectors, step.value);
      if (fillResult.isErr()) {
        return err(stepExecutionError(step.id, fillResult.error));
      }
      await settleAfterAction(page);
      const newUrl = page.url();
      await assertEffects(step, { beforeUrl, currentUrl: newUrl, page });
      return ok(newUrl);
    }

    if (step.action === "press" && step.key) {
      await page.keyboard.press(step.key);
      await settleAfterAction(page);
      const newUrl = page.url();
      await assertEffects(step, { beforeUrl, currentUrl: newUrl, page });
      return ok(newUrl);
    }

    return ok(currentUrl ?? page.url());
  } catch (cause) {
    return err(stepExecutionError(step.id, causeMessage(cause)));
  }
};

const parseContentDispositionFilename = (contentDisposition?: string): string | undefined => {
  if (!contentDisposition) return undefined;
  const filenameStar = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (filenameStar?.[1]) {
    try {
      return decodeURIComponent(filenameStar[1].trim().replace(/^"(.*)"$/, "$1"));
    } catch {
      // fallback to other patterns
    }
  }

  const filenameQuoted = contentDisposition.match(/filename\s*=\s*"([^"]+)"/i);
  if (filenameQuoted?.[1]) return filenameQuoted[1];

  const filenameBare = contentDisposition.match(/filename\s*=\s*([^;]+)/i);
  if (filenameBare?.[1]) return filenameBare[1].trim();

  return undefined;
};

const sanitizeFilename = (filename: string): string => {
  const sanitized = filename.replace(/[/\\?%*:|"<>]/g, "_").trim();
  return sanitized.length > 0 ? sanitized : "download";
};

const extensionFromContentType = (contentType?: string): string => {
  const normalized = (contentType ?? "").toLowerCase();
  if (normalized.includes("application/pdf")) return ".pdf";
  if (normalized.includes("text/csv")) return ".csv";
  if (
    normalized.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") ||
    normalized.includes("application/vnd.ms-excel")
  ) {
    return ".xlsx";
  }
  if (
    normalized.includes(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ) ||
    normalized.includes("application/msword")
  ) {
    return ".docx";
  }
  if (normalized.includes("application/zip")) return ".zip";
  return "";
};

const MAX_UNIQUE_PATH_ATTEMPTS = 1000;

const ensureUniquePathResult = async (targetPath: string): Promise<Result<string, string>> => {
  const parsed = path.parse(targetPath);
  for (let count = 0; count <= MAX_UNIQUE_PATH_ATTEMPTS; count++) {
    const candidate =
      count === 0 ? targetPath : path.join(parsed.dir, `${parsed.name}-${count}${parsed.ext}`);
    try {
      const handle = await fs.open(candidate, "wx");
      await handle.close();
      return ok(candidate);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") {
        return err(causeMessage(cause));
      }
    }
  }
  return err(
    `Could not find unique path after ${MAX_UNIQUE_PATH_ATTEMPTS} attempts: ${targetPath}`,
  );
};

const saveHttpDownloadIfNeeded = async (
  step: RecipeStep,
  response: Awaited<ReturnType<APIRequestContext["fetch"]>>,
  downloadDir: string,
): Promise<Result<void, string>> => {
  const responseUrl = response.url();
  const headers = response.headers();
  const contentDisposition = headers["content-disposition"];
  const shouldSave =
    step.download === true ||
    Boolean(contentDisposition?.toLowerCase().includes("attachment")) ||
    isDocumentDownload(responseUrl);

  if (!shouldSave) return ok(undefined);

  const headerFilename = parseContentDispositionFilename(contentDisposition);
  const urlBasename = (() => {
    try {
      const pathname = new URL(responseUrl).pathname;
      const base = path.basename(pathname);
      return base && base !== "/" ? base : undefined;
    } catch {
      return undefined;
    }
  })();

  const extension = extensionFromContentType(headers["content-type"]);
  const fallbackName = `${step.id}${extension}`;
  const filename = sanitizeFilename(headerFilename ?? urlBasename ?? fallbackName);
  const uniquePathResult = await ensureUniquePathResult(path.join(downloadDir, filename));
  if (uniquePathResult.isErr()) {
    return err(uniquePathResult.error);
  }
  const finalPath = uniquePathResult.value;
  try {
    const body = await response.body();
    await fs.writeFile(finalPath, body);
    process.stderr.write(`  Downloaded: ${finalPath}\n`);
    return ok(undefined);
  } catch (cause) {
    return err(causeMessage(cause));
  }
};

const setupDownloadHandler = (page: Page, downloadDir: string): void => {
  page.on("download", async (download) => {
    const filename = download.suggestedFilename();
    const savePath = path.join(downloadDir, filename);
    await download.saveAs(savePath);
    process.stderr.write(`  Downloaded: ${savePath}\n`);
  });
};

const extractHostnameForGuardUrl = (guardValue: string): string | undefined => {
  const normalized = guardValue.replace(/\*+$/, "");
  try {
    return new URL(normalized).hostname;
  } catch {
    return undefined;
  }
};

const parseHostname = (url: string): string | undefined => {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
};

const guardHostnameMatches = (guardValue: string, currentUrl: string): boolean => {
  const expected = extractHostnameForGuardUrl(guardValue);
  const actual = parseHostname(currentUrl);
  return Boolean(expected && actual && expected === actual);
};

const canSkipGuardForHttp = (step: RecipeStep, currentUrl: string | undefined): boolean => {
  if (!currentUrl) return false;
  for (const guard of step.guards ?? []) {
    if (guard.type === "url_is" && guardHostnameMatches(guard.value, currentUrl)) return true;
  }
  return false;
};

const syncHttpCookiesToBrowserContext = async (
  context: BrowserContext | null,
  httpContext: APIRequestContext | undefined,
): Promise<void> => {
  if (!context || !httpContext) return;
  try {
    const state = await httpContext.storageState();
    if (!state.cookies || state.cookies.length === 0) return;
    await context.addCookies(state.cookies);
  } catch {
    // best-effort only
  }
};

const runHttpStepResult = async (
  context: APIRequestContext,
  step: RecipeStep,
  guardUrl: string | undefined,
  beforeUrl: string | undefined,
  downloadDir: string,
  heal?: boolean,
): Promise<Result<string | undefined, RunExecuteError>> => {
  const guardResult = await validateGuards(step, { currentUrl: guardUrl });
  if (guardResult.isErr()) {
    if (heal && canSkipGuardForHttp(step, guardUrl)) {
      logGuardSkipped(step.guards?.find((g) => g.type === "url_is")?.value ?? "", guardUrl ?? "");
    } else {
      return err(stepExecutionError(step.id, formatStepValidationError(guardResult.error)));
    }
  }

  if (step.action !== "fetch" || !step.url) return ok(beforeUrl);

  try {
    const method = normalizeHttpMethod(step.method);
    const response = await context.fetch(step.url, {
      method,
      headers: step.headers,
      data: step.body,
      timeout: 5000,
    });
    const responseUrl = response.url();
    const downloadResult = await saveHttpDownloadIfNeeded(step, response, downloadDir);
    if (downloadResult.isErr()) {
      return err(stepExecutionError(step.id, downloadResult.error));
    }
    await assertEffects(step, { beforeUrl, currentUrl: responseUrl });
    return ok(responseUrl);
  } catch (cause) {
    return err(stepExecutionError(step.id, causeMessage(cause)));
  }
};

const executePwStepWithHealResult = async (
  page: Page,
  step: RecipeStep,
  currentUrl: string | undefined,
  llmCommand: string,
): Promise<
  Result<
    {
      currentUrl: string | undefined;
      healed: boolean;
      patchSelectors?: string[];
    },
    RunExecuteError
  >
> => {
  const guardResult = await validateGuards(step, { currentUrl: currentUrl ?? page.url(), page });
  if (guardResult.isErr()) {
    const healed = await tryGuardWithHeal(step, currentUrl ?? page.url(), page);
    if (!healed) {
      return err(stepExecutionError(step.id, formatStepValidationError(guardResult.error)));
    }
  }

  const firstRun = await executeStepResult(page, step, currentUrl);
  if (firstRun.isOk()) {
    return ok({ currentUrl: firstRun.value, healed: false });
  }
  if (step.action !== "click" && step.action !== "fill") {
    return err(firstRun.error);
  }

  logHealPhase1Start();
  const healResult = await healSelector(page, step, llmCommand);
  if (!healResult.healed) {
    logHealPhase1Failed();
    return err(firstRun.error);
  }

  logHealPhase1Success(healResult.strategy, healResult.newSelectors[0]);
  const patchedStep: RecipeStep = {
    ...step,
    selectorVariants: [...healResult.newSelectors, ...(step.selectorVariants ?? [])],
  };
  const patchedRun = await executeStepResult(page, patchedStep, currentUrl);
  if (patchedRun.isErr()) return err(patchedRun.error);

  return ok({
    currentUrl: patchedRun.value,
    healed: true,
    patchSelectors: healResult.newSelectors,
  });
};

const runPlanSteps = async (
  steps: RecipeStep[],
  downloadDir: string,
): Promise<Result<string | undefined, RunExecuteError>> => {
  const hasPwStep = steps.some((step) => step.mode === "pw");
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let pwContext: BrowserContext | null = null;
  let page: Page | null = null;
  let httpContext: APIRequestContext | undefined;

  try {
    if (hasPwStep) {
      browser = await chromium.launch({ headless: true });
      pwContext = await browser.newContext({ acceptDownloads: true });
      page = await pwContext.newPage();
      setupDownloadHandler(page, downloadDir);
    }

    let pageUrl: string | undefined;
    let httpUrl: string | undefined;
    let previousStepMode: RecipeStep["mode"] | undefined;
    for (const step of steps) {
      if (step.mode === "pw") {
        if (!page) {
          return err({
            kind: "context_unavailable",
            stepId: step.id,
            message: `Playwright page is not available for step ${step.id}`,
          });
        }
        if (httpContext) {
          try {
            await syncHttpCookiesToBrowserContext(pwContext, httpContext);
            await httpContext.dispose();
            httpContext = undefined;
          } catch (cause) {
            return err({
              kind: "step_execution_failed",
              stepId: step.id,
              message: causeMessage(cause),
            });
          }
        }

        try {
          await assertGuards(step, { currentUrl: pageUrl ?? page.url(), page });
          const executeResult = await executeStepResult(page, step, pageUrl);
          if (executeResult.isErr()) return err(executeResult.error);
          pageUrl = executeResult.value;
        } catch (cause) {
          return err(stepExecutionError(step.id, causeMessage(cause)));
        }
        previousStepMode = "pw";
        continue;
      }

      if (!httpContext || previousStepMode !== "http") {
        if (httpContext) {
          try {
            await httpContext.dispose();
          } catch (cause) {
            return err({
              kind: "step_execution_failed",
              stepId: step.id,
              message: causeMessage(cause),
            });
          }
        }
        try {
          const maybeStorage = pwContext ? await pwContext.storageState() : undefined;
          httpContext = await request.newContext(
            maybeStorage ? { storageState: maybeStorage } : undefined,
          );
        } catch (cause) {
          return err({
            kind: "step_execution_failed",
            stepId: step.id,
            message: causeMessage(cause),
          });
        }
      }

      const httpStepResult = await runHttpStepResult(
        httpContext,
        step,
        pageUrl ?? httpUrl,
        httpUrl ?? pageUrl,
        downloadDir,
      );
      if (httpStepResult.isErr()) return err(httpStepResult.error);
      httpUrl = httpStepResult.value;
      previousStepMode = "http";
    }

    return ok(pageUrl ?? httpUrl ?? page?.url());
  } catch (cause) {
    return err({
      kind: "unexpected_error",
      phase: "run",
      message: causeMessage(cause),
    });
  } finally {
    if (httpContext) {
      try {
        await httpContext.dispose();
      } catch {
        // noop
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch {
        // noop
      }
    }
  }
};

const runPlanStepsWithHeal = async (
  steps: RecipeStep[],
  llmCommand: string,
  downloadDir: string,
): Promise<Result<HealRunResult, RunExecuteError>> => {
  const healStats: HealStats = { phase1Healed: 0, phase2ReRecorded: 0 };
  const selectorPatches = new Map<string, string[]>();
  const phase2Replacements: HealRunResult["phase2Replacements"] = [];

  const hasPwStep = steps.some((step) => step.mode === "pw");
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let httpContext: APIRequestContext | undefined;

  try {
    if (hasPwStep) {
      browser = await chromium.launch({ headless: false });
      context = await browser.newContext({ acceptDownloads: true });
      page = await context.newPage();
      setupDownloadHandler(page, downloadDir);
    }

    const healRecordBuffer: RecordedEvent[] = [];
    let isRecording = false;
    if (context) {
      await injectRecordingCapabilities(context, async (_page, event) => {
        if (isRecording) healRecordBuffer.push(event);
      });
    }

    let pageUrl: string | undefined;
    let httpUrl: string | undefined;
    let previousStepMode: RecipeStep["mode"] | undefined;

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
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
          const httpStepResult = await runHttpStepResult(
            httpContext,
            step,
            pageUrl ?? httpUrl,
            httpUrl ?? pageUrl,
            downloadDir,
            true,
          );
          if (httpStepResult.isErr()) {
            logStepFailed(httpStepResult.error.message);
            return err(httpStepResult.error);
          }
          httpUrl = httpStepResult.value;
          previousStepMode = "http";
          logStepOk();
          continue;
        } catch (cause) {
          const message = causeMessage(cause);
          logStepFailed(message);
          return err({
            kind: "step_execution_failed",
            stepId: step.id,
            message,
          });
        }
      }

      if (!page) {
        const message = `Playwright page is not available for step ${step.id}`;
        logStepFailed(message);
        return err({
          kind: "context_unavailable",
          stepId: step.id,
          message,
        });
      }

      let stepFailure: RunExecuteError | null = null;
      try {
        if (httpContext) {
          await syncHttpCookiesToBrowserContext(context, httpContext);
          await httpContext.dispose();
          httpContext = undefined;
        }
        const result = await executePwStepWithHealResult(page, step, pageUrl, llmCommand);
        if (result.isErr()) {
          stepFailure = result.error;
        } else {
          pageUrl = result.value.currentUrl;
          if (result.value.healed && result.value.patchSelectors) {
            selectorPatches.set(step.id, result.value.patchSelectors);
            healStats.phase1Healed++;
          }
          previousStepMode = "pw";
          logStepOk();
          continue;
        }
      } catch (cause) {
        stepFailure = stepExecutionError(step.id, causeMessage(cause));
      }

      if (stepFailure) {
        logStepFailed(stepFailure.message);

        logHealPhase2Start(step.title);
        healRecordBuffer.length = 0;
        isRecording = true;

        await waitForEnter();

        isRecording = false;

        if (healRecordBuffer.length === 0) {
          return err({
            kind: "heal_record_failed",
            stepId: step.id,
            message: "no user actions recorded",
          });
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
          return err({
            kind: "heal_record_failed",
            stepId: step.id,
            message: "no executable steps recorded",
          });
        }
        const reNumberedSteps = newSteps.map((s, idx) => ({
          ...s,
          id: `${step.id}-healed-${idx + 1}`,
        }));

        logHealPhase2Success(reNumberedSteps.length);

        phase2Replacements.push({
          replacedFromStepId: step.id,
          newSteps: reNumberedSteps,
        });
        healStats.phase2ReRecorded++;

        for (const newStep of reNumberedSteps) {
          logStepStart(newStep.id, newStep.title);
          if (newStep.mode === "http") {
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
            } catch (cause) {
              const reMessage = causeMessage(cause);
              logStepFailed(reMessage);
              return err({
                kind: "re_record_failed",
                stepId: step.id,
                reRecordedStepId: newStep.id,
                message: reMessage,
              });
            }

            const httpStepResult = await runHttpStepResult(
              httpContext,
              newStep,
              pageUrl ?? httpUrl,
              httpUrl ?? pageUrl,
              downloadDir,
              true,
            );
            if (httpStepResult.isErr()) {
              logStepFailed(httpStepResult.error.message);
              return err({
                kind: "re_record_failed",
                stepId: step.id,
                reRecordedStepId: newStep.id,
                message: httpStepResult.error.message,
              });
            }
            httpUrl = httpStepResult.value;
            previousStepMode = "http";
            logStepOk();
            continue;
          }

          try {
            if (httpContext) {
              await syncHttpCookiesToBrowserContext(context, httpContext);
              await httpContext.dispose();
              httpContext = undefined;
            }
            await assertGuards(newStep, { currentUrl: pageUrl ?? page.url(), page });
          } catch (cause) {
            const reMessage = causeMessage(cause);
            logStepFailed(reMessage);
            return err({
              kind: "re_record_failed",
              stepId: step.id,
              reRecordedStepId: newStep.id,
              message: reMessage,
            });
          }

          const pwStepResult = await executeStepResult(page, newStep, pageUrl);
          if (pwStepResult.isErr()) {
            logStepFailed(pwStepResult.error.message);
            return err({
              kind: "re_record_failed",
              stepId: step.id,
              reRecordedStepId: newStep.id,
              message: pwStepResult.error.message,
            });
          }
          pageUrl = pwStepResult.value;
          previousStepMode = "pw";
          logStepOk();
        }
      }
    }

    return ok({
      lastUrl: pageUrl ?? httpUrl ?? page?.url(),
      healStats,
      selectorPatches,
      phase2Replacements,
    });
  } catch (cause) {
    return err({
      kind: "unexpected_error",
      phase: "run_heal",
      message: causeMessage(cause),
    });
  } finally {
    if (httpContext) {
      try {
        await httpContext.dispose();
      } catch {
        // noop
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch {
        // noop
      }
    }
  }
};

const runCommandInternalResult = async (
  name: string,
  options: RunOptions,
): Promise<Result<void, CommandError>> => {
  const commandName = options.planOnly ? "plan" : "run";
  const recipeResult = await loadRecipeResult(name);
  if (recipeResult.isErr()) {
    return err(toCommandError(commandName, formatRecipeStoreError(recipeResult.error)));
  }
  const recipe = recipeResult.value;
  const cliVarsResult = parseCliVariablesResult(options.vars ?? []);
  if (cliVarsResult.isErr()) {
    const message = formatTemplateVarError(cliVarsResult.error);
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ name, version: recipe.version, ok: false, phase: "plan", error: message })}\n`,
      );
    }
    return err(toCommandError(commandName, message));
  }

  const planResult = await buildExecutionPlanResult(recipe, {
    cliVars: cliVarsResult.value,
    llmCommand: options.llmCommand,
  });
  if (planResult.isErr()) {
    const message = formatBuildExecutionPlanError(planResult.error);
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ name, version: recipe.version, ok: false, phase: "plan", error: message })}\n`,
      );
    }
    return err(toCommandError(commandName, message));
  }
  const plan = planResult.value;

  if (plan.unresolvedVars.length > 0) {
    const message = `Unresolved variables: ${plan.unresolvedVars.join(", ")}`;
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ name, version: recipe.version, ok: false, phase: "plan", ...plan })}\n`,
      );
    }
    return err(toCommandError(commandName, message));
  }

  if (options.planOnly) {
    process.stdout.write(
      `${JSON.stringify({ name, version: recipe.version, ok: true, phase: "plan", ...plan })}\n`,
    );
    return ok(undefined);
  }

  const downloadDir = await resolveDownloadDir(name, recipe.downloadDir);
  let executedVersion = recipe.version;
  const executeFailure = (message: string): Result<void, CommandError> => {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({
          name,
          version: executedVersion,
          ok: false,
          phase: "execute",
          error: message,
          resolvedVars: plan.resolvedVars,
          warnings: plan.warnings,
        })}\n`,
      );
    }
    return err(toCommandError(commandName, message));
  };

  try {
    if (options.heal) {
      const runResult = await runPlanStepsWithHeal(
        plan.steps,
        options.llmCommand ?? "claude",
        downloadDir,
      );
      if (runResult.isErr()) {
        return executeFailure(formatRunExecuteError(runResult.error));
      }

      const { healStats, selectorPatches, phase2Replacements } = runResult.value;
      if (healStats.phase1Healed > 0 || healStats.phase2ReRecorded > 0) {
        let mergedSteps = recipe.steps.map((s) => {
          const newSelectors = selectorPatches.get(s.id);
          if (newSelectors) {
            return { ...s, selectorVariants: [...newSelectors, ...(s.selectorVariants ?? [])] };
          }
          return s;
        });

        mergedSteps = applyPhase2Replacements(mergedSteps, phase2Replacements);

        const healed: Recipe = {
          ...recipe,
          version: recipe.version + 1,
          updatedAt: new Date().toISOString(),
          source: "healed",
          steps: mergedSteps,
          notes:
            `${recipe.notes ?? ""}\nSelf-healed: ${healStats.phase1Healed} auto-fixed, ${healStats.phase2ReRecorded} re-recorded.`.trim(),
        };
        const saveResult = await saveRecipeResult(healed);
        if (saveResult.isErr()) {
          return executeFailure(formatRecipeStoreError(saveResult.error));
        }
        executedVersion = healed.version;
        logRecipeSaved(name, healed.version);
        logHealSummary(healStats.phase1Healed, healStats.phase2ReRecorded);
      }
    } else {
      const runResult = await runPlanSteps(plan.steps, downloadDir);
      if (runResult.isErr()) {
        return executeFailure(formatRunExecuteError(runResult.error));
      }
    }
  } catch (cause) {
    const message = causeMessage(cause);
    return executeFailure(message);
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        name,
        version: executedVersion,
        ok: true,
        phase: "execute",
        resolvedVars: plan.resolvedVars,
        warnings: plan.warnings,
      })}\n`,
    );
  }
  return ok(undefined);
};

export const runCommandResult = async (
  name: string,
  options: RunOptions,
): Promise<Result<void, CommandError>> => {
  return runCommandInternalResult(name, options);
};

export const runCommand = async (name: string, options: RunOptions): Promise<void> => {
  const result = await runCommandResult(name, options);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
};

/** @internal */
export const _runInternals = {
  extractHostnameForGuardUrl,
  guardHostnameMatches,
  canSkipGuardForHttp,
  syncHttpCookiesToBrowserContext,
  parseContentDispositionFilename,
  extensionFromContentType,
  applyPhase2Replacements,
  formatRunExecuteError,
};
