import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { recordingSnapshotsDir } from "../core/fs.js";
import { injectRecordingCapabilities } from "../core/init-script.js";
import { appendRecordedEvent, initRecording } from "../core/record-store.js";
import { saveSecret } from "../core/secret-store.js";

type RecordOptions = {
  url: string;
};

const nowIso = (): string => new Date().toISOString();

const wirePageEvents = async (name: string, page: Page): Promise<void> => {
  page.on("framenavigated", async (frame) => {
    if (frame !== page.mainFrame()) return;
    await appendRecordedEvent(name, {
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
    await appendRecordedEvent(name, {
      ts: nowIso(),
      type: "request",
      url: page.url(),
      requestUrl: request.url(),
      method: request.method(),
      headers: request.headers(),
    });
  });

  page.on("response", async (response) => {
    await appendRecordedEvent(name, {
      ts: nowIso(),
      type: "response",
      url: page.url(),
      responseUrl: response.url(),
      status: response.status(),
      headers: response.headers(),
    });
  });

  page.on("console", async (message) => {
    await appendRecordedEvent(name, {
      ts: nowIso(),
      type: "console",
      url: page.url(),
      value: message.text(),
    });
  });
};

export const recordCommand = async (name: string, options: RecordOptions): Promise<void> => {
  await initRecording(name);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  const capturedSecrets = new Map<string, string>();
  await injectRecordingCapabilities(
    context,
    async (_page, event) => {
      await appendRecordedEvent(name, event);
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
    await saveSecret(name, fieldName, value);
  }

  await browser.close();
};
