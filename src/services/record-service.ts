import fs from "node:fs/promises";
import path from "node:path";
import { type Result, err, ok } from "neverthrow";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { recordingSnapshotsDir } from "../core/fs.js";
import { injectRecordingCapabilities } from "../core/init-script.js";
import {
  appendRecordedEventResult,
  formatRecordStoreError,
  initRecordingResult,
} from "../core/record-store.js";
import { formatSecretStoreError, saveSecretResult } from "../core/secret-store.js";
import type { RecordedEvent } from "../types.js";
import type { ProgressReporter } from "./progress.js";
import { nullReporter } from "./progress.js";
import type { ServiceError } from "./types.js";

export type RecordServiceOptions = {
  progress?: ProgressReporter;
};

export type RecordResult = {
  name: string;
  eventCount: number;
};

/** Handle that allows the caller to stop an active recording session. */
export type RecordSession = {
  /** Resolves when the recording finishes (browser closed or stop called). */
  done: Promise<Result<RecordResult, ServiceError>>;
  /** Programmatically stop the recording. */
  stop: () => Promise<void>;
};

const nowIso = (): string => new Date().toISOString();

/**
 * Start a recording session.
 *
 * This launches a headed Chromium browser and records user interactions.
 * The returned `RecordSession` provides a `done` promise that resolves when
 * the user closes the browser or `stop()` is called.
 */
export const startRecordSession = async (
  name: string,
  url: string,
  options: RecordServiceOptions = {},
): Promise<Result<RecordSession, ServiceError>> => {
  const progress = options.progress ?? nullReporter;

  const initResult = await initRecordingResult(name);
  if (initResult.isErr()) {
    return err({
      code: "recording_init_failed",
      message: formatRecordStoreError(initResult.error),
    });
  }

  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: false });
  } catch (cause) {
    return err({
      code: "browser_launch_failed",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }

  progress({ type: "info", message: `Recording started: ${name}` });

  let eventCount = 0;
  let asyncError: ServiceError | null = null;

  const appendEvent = async (recordName: string, event: RecordedEvent): Promise<void> => {
    const result = await appendRecordedEventResult(recordName, event);
    if (result.isErr()) {
      asyncError = {
        code: "recording_append_failed",
        message: formatRecordStoreError(result.error),
      };
    } else {
      eventCount++;
    }
  };

  const capturedSecrets = new Map<string, string>();

  const done = (async (): Promise<Result<RecordResult, ServiceError>> => {
    try {
      const context = await browser.newContext();

      await injectRecordingCapabilities(
        context,
        async (_page: Page, event: RecordedEvent) => {
          await appendEvent(name, event);
        },
        (fieldName: string, value: string) => {
          capturedSecrets.set(fieldName, value);
        },
      );

      const page = await context.newPage();

      page.on("framenavigated", async (frame) => {
        if (frame !== page.mainFrame()) return;
        await appendEvent(name, {
          ts: nowIso(),
          type: "navigation",
          url: frame.url(),
          effects: [{ type: "url_changed", value: frame.url() }],
        });

        try {
          const html = await page.content();
          const snapshotPath = path.join(recordingSnapshotsDir(name), `${Date.now()}.html`);
          await fs.writeFile(snapshotPath, html, "utf-8");
        } catch {
          // noop
        }
      });

      page.on("request", async (request) => {
        await appendEvent(name, {
          ts: nowIso(),
          type: "request",
          url: page.url(),
          requestUrl: request.url(),
          method: request.method(),
          headers: request.headers(),
          postData: request.postData() ?? undefined,
        });
      });

      page.on("response", async (response) => {
        await appendEvent(name, {
          ts: nowIso(),
          type: "response",
          url: page.url(),
          responseUrl: response.url(),
          status: response.status(),
          headers: response.headers(),
        });
      });

      page.on("console", async (message) => {
        await appendEvent(name, {
          ts: nowIso(),
          type: "console",
          url: page.url(),
          value: message.text(),
        });
      });

      progress({ type: "info", message: `Navigating to ${url}` });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      progress({ type: "info", message: "Browser opened. Recording user actions..." });

      await page.waitForEvent("close", { timeout: 0 });

      if (asyncError) return err(asyncError);

      for (const [fieldName, value] of capturedSecrets) {
        const saveResult = await saveSecretResult(name, fieldName, value);
        if (saveResult.isErr()) {
          return err({
            code: "secret_save_failed",
            message: formatSecretStoreError(saveResult.error),
          });
        }
      }

      progress({
        type: "info",
        message: `Recording completed: ${eventCount} events captured`,
      });

      return ok({ name, eventCount });
    } catch (cause) {
      return err({
        code: "unexpected",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      await browser.close();
    }
  })();

  const stop = async (): Promise<void> => {
    try {
      await browser.close();
    } catch {
      // browser may already be closed
    }
  };

  return ok({ done, stop });
};
