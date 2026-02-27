import type { BrowserContext, Page } from "playwright";
import type { RecordedEvent } from "../types.js";

export const INIT_SCRIPT_SOURCE = `
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

export const injectRecordingCapabilities = async (
  context: BrowserContext,
  onEvent: (page: Page, event: RecordedEvent) => Promise<void>,
  onSecret?: (fieldName: string, value: string) => void,
): Promise<void> => {
  await context.exposeBinding(
    "__browrec_push",
    async ({ page }, payload: Omit<RecordedEvent, "ts" | "url">) => {
      const event: RecordedEvent = {
        ts: new Date().toISOString(),
        url: page.url(),
        ...payload,
      };
      await onEvent(page, event);
    },
  );

  if (onSecret) {
    await context.exposeBinding(
      "__browrec_secret",
      async (_source, payload: { fieldName: string; value: string }) => {
        onSecret(payload.fieldName, payload.value);
      },
    );
  }

  await context.addInitScript({ content: INIT_SCRIPT_SOURCE });
};
