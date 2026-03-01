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
): Promise<Result<void, CommandError>> => {
  const result = await appendRecordedEventResult(name, event);
  if (result.isErr()) {
    return err(toCommandError("record", formatRecordStoreError(result.error)));
  }
  return ok(undefined);
};

const wirePageEvents = async (
  name: string,
  page: Page,
  onError: (error: CommandError) => void,
): Promise<void> => {
  page.on("framenavigated", async (frame) => {
    if (frame !== page.mainFrame()) return;
    const appendResult = await appendEvent(name, {
      ts: nowIso(),
      type: "navigation",
      url: frame.url(),
      effects: [{ type: "url_changed", value: frame.url() }],
    });
    if (appendResult.isErr()) {
      onError(appendResult.error);
      return;
    }

    try {
      const html = await page.content();
      const snapshotPath = path.join(recordingSnapshotsDir(name), `${Date.now()}.html`);
      await fs.writeFile(snapshotPath, html, "utf-8");
    } catch {
      // noop
    }
  });

  page.on("request", async (request) => {
    const appendResult = await appendEvent(name, {
      ts: nowIso(),
      type: "request",
      url: page.url(),
      requestUrl: request.url(),
      method: request.method(),
      headers: request.headers(),
      postData: request.postData() ?? undefined,
    });
    if (appendResult.isErr()) {
      onError(appendResult.error);
    }
  });

  page.on("response", async (response) => {
    const appendResult = await appendEvent(name, {
      ts: nowIso(),
      type: "response",
      url: page.url(),
      responseUrl: response.url(),
      status: response.status(),
      headers: response.headers(),
    });
    if (appendResult.isErr()) {
      onError(appendResult.error);
    }
  });

  page.on("console", async (message) => {
    const appendResult = await appendEvent(name, {
      ts: nowIso(),
      type: "console",
      url: page.url(),
      value: message.text(),
    });
    if (appendResult.isErr()) {
      onError(appendResult.error);
    }
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
  const initResult = await initRecordingResult(name);
  if (initResult.isErr()) {
    return err(toCommandError("record", formatRecordStoreError(initResult.error)));
  }

  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    let asyncError: CommandError | null = null;
    const setAsyncError = (error: CommandError): void => {
      if (!asyncError) asyncError = error;
    };

    const capturedSecrets = new Map<string, string>();
    await injectRecordingCapabilities(
      context,
      async (_page, event) => {
        const appendResult = await appendEvent(name, event);
        if (appendResult.isErr()) {
          setAsyncError(appendResult.error);
        }
      },
      (fieldName, value) => {
        capturedSecrets.set(fieldName, value);
      },
    );

    const page = await context.newPage();
    await wirePageEvents(name, page, setAsyncError);

    await page.goto(options.url, { waitUntil: "domcontentloaded" });

    await page.waitForEvent("close", { timeout: 0 });
    if (asyncError) return err(asyncError);

    for (const [fieldName, value] of capturedSecrets) {
      const saveResult = await saveSecretResult(name, fieldName, value);
      if (saveResult.isErr()) {
        return err(toCommandError("record", formatSecretStoreError(saveResult.error)));
      }
    }

    return ok(undefined);
  } catch (cause) {
    return err(toCommandError("record", cause));
  } finally {
    await browser.close();
  }
};
