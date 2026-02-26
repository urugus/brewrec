import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { recordingSnapshotsDir } from "../core/fs.js";
import { appendRecordedEvent, initRecording } from "../core/record-store.js";
import type { RecordedEvent } from "../types.js";

type RecordOptions = {
  url: string;
};

const nowIso = (): string => {
  return new Date().toISOString();
};

const wirePageEvents = async (name: string, page: Page): Promise<void> => {
  await page.exposeBinding(
    "__browrec_push",
    async (_source, payload: Omit<RecordedEvent, "ts" | "url">) => {
      const event: RecordedEvent = {
        ts: nowIso(),
        url: page.url(),
        ...payload,
      };
      await appendRecordedEvent(name, event);
    },
  );

  await page.addInitScript(() => {
    const toCssPath = (el: Element): string => {
      const parts: string[] = [];
      let current: Element | null = el;
      while (current && parts.length < 5) {
        const tag = current.tagName.toLowerCase();
        const id = current.id ? `#${current.id}` : "";
        const cls =
          current.className && typeof current.className === "string"
            ? `.${current.className.trim().split(/\s+/).slice(0, 2).join(".")}`
            : "";
        parts.unshift(`${tag}${id}${cls}`);
        current = current.parentElement;
      }
      return parts.join(" > ");
    };

    const toNearbyText = (el: Element): string[] => {
      const out: string[] = [];
      const label = el.closest("label");
      if (label?.textContent?.trim()) out.push(label.textContent.trim());
      const prev = el.previousElementSibling?.textContent?.trim();
      if (prev) out.push(prev);
      const parentText = el.parentElement?.textContent?.trim();
      if (parentText) out.push(parentText.slice(0, 80));
      return out.slice(0, 3);
    };

    const buildAnchors = (el: Element) => {
      const role = el.getAttribute("role") ?? undefined;
      const name =
        el.getAttribute("name") ??
        el.getAttribute("aria-label") ??
        el.textContent?.trim().slice(0, 60) ??
        undefined;
      const placeholder = (el as HTMLInputElement).placeholder || undefined;
      const label =
        el.id && document.querySelector(`label[for=\"${el.id}\"]`)?.textContent?.trim()
          ? document.querySelector(`label[for=\"${el.id}\"]`)?.textContent?.trim()
          : undefined;

      const selectorVariants = [
        role && name ? `[role=\"${role}\"][name=\"${name}\"]` : undefined,
        label ? `label:has-text(\"${label}\")` : undefined,
        placeholder ? `input[placeholder=\"${placeholder}\"]` : undefined,
        toCssPath(el),
      ].filter(Boolean) as string[];

      return {
        role,
        name,
        label,
        placeholder,
        nearbyText: toNearbyText(el),
        css: toCssPath(el),
        selectorVariants,
      };
    };

    document.addEventListener(
      "click",
      (ev) => {
        const target = ev.target;
        if (!(target instanceof Element)) return;
        // @ts-ignore
        window.__browrec_push({ type: "click", anchors: buildAnchors(target) });
      },
      { capture: true },
    );

    document.addEventListener(
      "input",
      (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
        // @ts-ignore
        window.__browrec_push({
          type: "input",
          anchors: buildAnchors(target),
          value: target.value,
        });
      },
      { capture: true },
    );

    document.addEventListener(
      "keydown",
      (ev) => {
        // @ts-ignore
        window.__browrec_push({ type: "keypress", key: ev.key });
      },
      { capture: true },
    );
  });

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
  const page = await context.newPage();

  await wirePageEvents(name, page);
  await page.goto(options.url, { waitUntil: "domcontentloaded" });

  await page.waitForEvent("close");
  await browser.close();
};
