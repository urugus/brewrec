import path from "node:path";
import { type Result, err, ok } from "neverthrow";
import { chromium } from "playwright";
import { resolveDownloadDir } from "../core/fs.js";
import { ARTIFACTS_DIR } from "../core/paths.js";
import { planServiceResult } from "./plan-service.js";
import { nullReporter } from "./progress.js";
import type { ProgressReporter } from "./progress.js";
import type { ServiceError } from "./types.js";

export type DebugResult = {
  name: string;
  version: number;
  ok: boolean;
  stepsTotal: number;
  stepsCompleted: number;
  videoPath?: string;
  error?: string;
};

export type DebugServiceOptions = {
  vars?: string[];
  llmCommand?: string;
  progress?: ProgressReporter;
};

export const debugServiceResult = async (
  name: string,
  options: DebugServiceOptions = {},
): Promise<Result<DebugResult, ServiceError>> => {
  const progress = options.progress ?? nullReporter;

  const planResult = await planServiceResult(name, {
    vars: options.vars,
    llmCommand: options.llmCommand,
  });
  if (planResult.isErr()) {
    return err(planResult.error);
  }
  const { version, plan } = planResult.value;

  const downloadDir = await resolveDownloadDir(name, planResult.value.downloadDir);

  const stepsTotal = plan.steps.length;
  progress({ type: "info", message: `Debug: executing ${stepsTotal} steps in headful browser...` });

  const browser = await chromium.launch({ headless: false });
  let stepsCompleted = 0;

  try {
    const context = await browser.newContext({
      acceptDownloads: true,
      recordVideo: {
        dir: ARTIFACTS_DIR,
        size: { width: 1280, height: 720 },
      },
    });
    const page = await context.newPage();
    page.on("download", async (download) => {
      const savePath = path.join(downloadDir, download.suggestedFilename());
      await download.saveAs(savePath);
      progress({ type: "info", message: `Downloaded: ${savePath}` });
    });

    for (const step of plan.steps) {
      const title = step.title || `${step.action} ${step.url ?? ""}`.trim();
      progress({ type: "step_start", stepId: step.id, title });

      try {
        if (step.action === "goto" && step.url) {
          await page.goto(step.url);
          stepsCompleted++;
          progress({ type: "step_ok", stepId: step.id });
          continue;
        }
        if (step.action === "click") {
          const selector = step.selectorVariants?.[0];
          if (selector) {
            await page.locator(selector).first().click();
          }
          stepsCompleted++;
          progress({ type: "step_ok", stepId: step.id });
          continue;
        }
        if (step.action === "fill" && step.value !== undefined) {
          const selector = step.selectorVariants?.[0];
          if (selector) {
            await page.locator(selector).first().fill(step.value);
          }
          stepsCompleted++;
          progress({ type: "step_ok", stepId: step.id });
          continue;
        }
        if (step.action === "press" && step.key) {
          await page.keyboard.press(step.key);
          stepsCompleted++;
          progress({ type: "step_ok", stepId: step.id });
          continue;
        }

        // Unknown action - skip
        stepsCompleted++;
        progress({ type: "step_ok", stepId: step.id });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        progress({ type: "step_failed", stepId: step.id, error: message });

        // Close context to finalize video
        const videoPath = await page.video()?.path();
        await context.close();

        return ok({
          name,
          version,
          ok: false,
          stepsTotal,
          stepsCompleted,
          videoPath,
          error: `Step ${step.id} failed: ${message}`,
        });
      }
    }

    // All steps completed - finalize video
    const videoPath = await page.video()?.path();
    await context.close();

    progress({ type: "info", message: "Debug completed successfully." });

    return ok({
      name,
      version,
      ok: true,
      stepsTotal,
      stepsCompleted,
      videoPath,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return err({ code: "debug_failed", message });
  } finally {
    await browser.close();
  }
};
