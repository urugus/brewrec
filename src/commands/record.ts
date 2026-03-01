import fs from "node:fs/promises";
import path from "node:path";
import { type Result, err, ok } from "neverthrow";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { recordingSnapshotsDir } from "../core/fs.js";
import { injectRecordingCapabilities } from "../core/init-script.js";
import {
  appendRecordedEventResult,
  formatRecordStoreError,
  initRecordingResult,
} from "../core/record-store.js";
import { formatSecretStoreError, saveSecretResult } from "../core/secret-store.js";
import type { CommandError } from "./result.js";
import { toCommandError } from "./result.js";

type RecordOptions = {
  url: string;
};

const nowIso = (): string => new Date().toISOString();

const appendEvent = async (
  name: string,
  event: Parameters<typeof appendRecordedEventResult>[1],
) => {
  const result = await appendRecordedEventResult(name, event);
  if (result.isErr()) {
    throw new Error(formatRecordStoreError(result.error));
  }
};

const wirePageEvents = async (name: string, page: Page): Promise<void> => {
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
};

export const recordCommand = async (name: string, options: RecordOptions): Promise<void> => {
  const result = await recordCommandResult(name, options);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
};

export const recordCommandResult = async (
  name: string,
  options: RecordOptions,
): Promise<Result<void, CommandError>> => {
  try {
    const initResult = await initRecordingResult(name);
    if (initResult.isErr()) {
      throw new Error(formatRecordStoreError(initResult.error));
    }

    const browser = await chromium.launch({ headless: false });
    try {
      const context = await browser.newContext();

      const capturedSecrets = new Map<string, string>();
      await injectRecordingCapabilities(
        context,
        async (_page, event) => {
          await appendEvent(name, event);
        },
        (fieldName, value) => {
          capturedSecrets.set(fieldName, value);
        },
      );

      const page = await context.newPage();
      await wirePageEvents(name, page);

      await page.goto(options.url, { waitUntil: "domcontentloaded" });

      await page.waitForEvent("close", { timeout: 0 });

      for (const [fieldName, value] of capturedSecrets) {
        const saveResult = await saveSecretResult(name, fieldName, value);
        if (saveResult.isErr()) {
          throw new Error(formatSecretStoreError(saveResult.error));
        }
      }
    } finally {
      await browser.close();
    }
    return ok(undefined);
  } catch (cause) {
    return err(toCommandError("record", cause));
  }
};
