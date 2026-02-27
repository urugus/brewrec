import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";
import { recordingSnapshotsDir } from "../core/fs.js";
import { appendRecordedEvent, initRecording } from "../core/record-store.js";
import { saveSecret } from "../core/secret-store.js";
import type { RecordedEvent } from "../types.js";

type RecordOptions = {
  url: string;
};

const nowIso = (): string => {
  return new Date().toISOString();
};

const INIT_SCRIPT_SOURCE = `
(function() {
  var toCssPath = function(el) {
    var parts = [];
    var current = el;
    while (current && parts.length < 5) {
      var tag = current.tagName.toLowerCase();
      var id = current.id ? "#" + current.id : "";
      var cls = current.className && typeof current.className === "string"
        ? "." + current.className.trim().split(/\\s+/).slice(0, 2).join(".")
        : "";
      parts.unshift(tag + id + cls);
      current = current.parentElement;
    }
    return parts.join(" > ");
  };

  var toNearbyText = function(el) {
    var out = [];
    var label = el.closest("label");
    if (label && label.textContent && label.textContent.trim()) out.push(label.textContent.trim());
    var prev = el.previousElementSibling;
    if (prev && prev.textContent && prev.textContent.trim()) out.push(prev.textContent.trim());
    var parent = el.parentElement;
    if (parent && parent.textContent && parent.textContent.trim()) out.push(parent.textContent.trim().slice(0, 80));
    return out.slice(0, 3);
  };

  var buildAnchors = function(el) {
    var role = el.getAttribute("role") || undefined;
    var name = el.getAttribute("name") || el.getAttribute("aria-label") || (el.textContent ? el.textContent.trim().slice(0, 60) : undefined) || undefined;
    var placeholder = el.placeholder || undefined;
    var labelEl = el.id ? document.querySelector('label[for="' + el.id + '"]') : null;
    var label = labelEl && labelEl.textContent ? labelEl.textContent.trim() : undefined;

    var selectorVariants = [
      role && name ? '[role="' + role + '"][name="' + name + '"]' : undefined,
      label ? 'label:has-text("' + label + '")' : undefined,
      placeholder ? 'input[placeholder="' + placeholder + '"]' : undefined,
      toCssPath(el)
    ].filter(Boolean);

    return {
      role: role,
      name: name,
      label: label,
      placeholder: placeholder,
      nearbyText: toNearbyText(el),
      css: toCssPath(el),
      selectorVariants: selectorVariants
    };
  };

  var inferFieldName = function(el) {
    var ac = el.getAttribute("autocomplete");
    if (ac && ac !== "off" && ac !== "on") {
      return ac.replace("current-", "").replace("new-", "");
    }
    var name = el.getAttribute("name");
    if (name) {
      var match = name.match(/\\[([^\\]]+)\\]$/);
      if (match) return match[1];
      return name.replace(/[^a-zA-Z0-9_]/g, "_");
    }
    var type = el.type;
    if (type === "password" || type === "email") return type;
    if (el.id) return el.id.replace(/[^a-zA-Z0-9_]/g, "_");
    return "credential";
  };

  var safeSecretPush = function(payload) {
    try {
      if (typeof window.__browrec_secret === "function") {
        window.__browrec_secret(payload);
      }
    } catch (err) {
      console.error("[browrec] secret push error:", err);
    }
  };

  var isCredentialField = function(el) {
    if (!(el instanceof HTMLInputElement)) return false;
    if (el.type === "password") return true;
    var form = el.closest("form");
    if (!form) return false;
    if (!form.querySelector('input[type="password"]')) return false;
    var type = (el.type || "").toLowerCase();
    var autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
    var name = (el.getAttribute("name") || "").toLowerCase();
    if (type === "email" || type === "tel") return true;
    if (autocomplete === "username" || autocomplete === "email") return true;
    if (name.includes("user") || name.includes("email") || name.includes("login") || name.includes("account")) return true;
    return false;
  };

  var safePush = function(payload) {
    try {
      if (typeof window.__browrec_push === "function") {
        window.__browrec_push(payload);
      } else {
        console.warn("[browrec] __browrec_push not available, type:", typeof window.__browrec_push);
      }
    } catch (err) {
      console.error("[browrec] push error:", err);
    }
  };

  document.addEventListener("click", function(ev) {
    var target = ev.target;
    if (!(target instanceof Element)) return;
    safePush({ type: "click", anchors: buildAnchors(target) });
  }, { capture: true });

  document.addEventListener("input", function(ev) {
    var target = ev.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    var isPassword = (target instanceof HTMLInputElement && target.type === "password");
    var isSecret = isPassword || isCredentialField(target);
    var fieldName = isSecret ? inferFieldName(target) : undefined;

    safePush({
      type: "input",
      anchors: buildAnchors(target),
      value: isSecret ? "***" : target.value,
      secret: isSecret || undefined,
      secretFieldName: fieldName || undefined
    });

    if (isSecret && fieldName) {
      safeSecretPush({ fieldName: fieldName, value: target.value });
    }
  }, { capture: true });

  document.addEventListener("keydown", function(ev) {
    safePush({ type: "keypress", key: ev.key });
  }, { capture: true });
})();
`;

const wireContextEvents = async (
  name: string,
  context: BrowserContext,
): Promise<{ capturedSecrets: Map<string, string> }> => {
  const capturedSecrets = new Map<string, string>();

  await context.exposeBinding(
    "__browrec_push",
    async ({ page }, payload: Omit<RecordedEvent, "ts" | "url">) => {
      const event: RecordedEvent = {
        ts: nowIso(),
        url: page.url(),
        ...payload,
      };
      await appendRecordedEvent(name, event);
    },
  );

  await context.exposeBinding(
    "__browrec_secret",
    async (_source, payload: { fieldName: string; value: string }) => {
      capturedSecrets.set(payload.fieldName, payload.value);
    },
  );

  await context.addInitScript({ content: INIT_SCRIPT_SOURCE });

  return { capturedSecrets };
};

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

  const { capturedSecrets } = await wireContextEvents(name, context);

  const page = await context.newPage();
  await wirePageEvents(name, page);

  await page.goto(options.url, { waitUntil: "domcontentloaded" });

  await page.waitForEvent("close", { timeout: 0 });

  for (const [fieldName, value] of capturedSecrets) {
    await saveSecret(name, fieldName, value);
  }

  await browser.close();
};
