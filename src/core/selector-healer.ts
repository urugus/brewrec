import type { Page } from "playwright";
import type { RecipeStep } from "../types.js";
import { runLocalClaude } from "./llm.js";

export type SelectorHints = {
  placeholder?: string;
  name?: string;
  id?: string;
  role?: string;
  text?: string;
};

export type HealResult = {
  healed: boolean;
  newSelectors: string[];
  strategy: string;
};

export const extractHintsFromSelector = (selector: string): SelectorHints => {
  const hints: SelectorHints = {};

  const placeholderMatch = selector.match(/placeholder="([^"]+)"/);
  if (placeholderMatch) hints.placeholder = placeholderMatch[1];

  const nameMatch = selector.match(/\[name="([^"]+)"\]/);
  if (nameMatch) hints.name = nameMatch[1];

  const idMatch = selector.match(/#([\w:-]+)/);
  if (idMatch) hints.id = idMatch[1];

  const roleMatch = selector.match(/role="([^"]+)"/);
  if (roleMatch) hints.role = roleMatch[1];

  const textMatch = selector.match(/has-text\("([^"]+)"\)/);
  if (textMatch) hints.text = textMatch[1];

  return hints;
};

const collectHints = (selectors: string[]): SelectorHints => {
  const merged: SelectorHints = {};
  for (const sel of selectors) {
    const h = extractHintsFromSelector(sel);
    if (h.placeholder) merged.placeholder ??= h.placeholder;
    if (h.name) merged.name ??= h.name;
    if (h.id) merged.id ??= h.id;
    if (h.role) merged.role ??= h.role;
    if (h.text) merged.text ??= h.text;
  }
  return merged;
};

const escapeCssValue = (value: string): string => {
  return value.replace(/["\\]/g, "\\$&");
};

const isLocatable = async (page: Page, selector: string): Promise<boolean> => {
  try {
    const count = await page.locator(selector).count();
    return count > 0;
  } catch {
    return false;
  }
};

const tryHeuristicHeal = async (
  page: Page,
  step: RecipeStep,
  hints: SelectorHints,
): Promise<HealResult> => {
  const candidates: Array<{ selector: string; strategy: string }> = [];

  if (hints.id) {
    candidates.push({ selector: `#${hints.id}`, strategy: "id" });
  }
  if (hints.placeholder) {
    candidates.push({
      selector: `[placeholder="${escapeCssValue(hints.placeholder)}"]`,
      strategy: "placeholder-exact",
    });
    const firstWord = hints.placeholder.split(" ")[0];
    if (firstWord && firstWord.length >= 3) {
      candidates.push({
        selector: `[placeholder*="${escapeCssValue(firstWord)}"]`,
        strategy: "placeholder-partial",
      });
    }
  }
  if (hints.name) {
    candidates.push({ selector: `[name="${escapeCssValue(hints.name)}"]`, strategy: "name-attr" });
  }
  if (hints.text && step.action === "click") {
    candidates.push({ selector: `text="${hints.text}"`, strategy: "text-content" });
  }

  for (const c of candidates) {
    if (await isLocatable(page, c.selector)) {
      return { healed: true, newSelectors: [c.selector], strategy: c.strategy };
    }
  }

  return { healed: false, newSelectors: [], strategy: "" };
};

const truncateHtml = (html: string, maxLength = 30000): string => {
  if (html.length <= maxLength) return html;
  return `${html.slice(0, maxLength)}\n<!-- ... truncated ... -->`;
};

export const parseSelectorsFromLlmResponse = (response: string): string[] => {
  const selectors: string[] = [];
  const lines = response.split("\n");
  for (const line of lines) {
    const trimmed = line.replace(/^(?:\d+[.)]\s*|-\s+|\*\s+)/, "").trim();
    if (!trimmed) continue;

    const backtickMatch = trimmed.match(/`([^`]+)`/);
    if (backtickMatch) {
      selectors.push(backtickMatch[1]);
      continue;
    }

    if (/^[a-zA-Z#.\[:\w]/.test(trimmed) && !trimmed.includes(" ") && trimmed.length < 200) {
      selectors.push(trimmed);
    }
  }
  return selectors;
};

const tryLlmHeal = async (
  page: Page,
  step: RecipeStep,
  hints: SelectorHints,
  llmCommand: string,
): Promise<HealResult> => {
  let html: string;
  try {
    html = await page.content();
  } catch {
    return { healed: false, newSelectors: [], strategy: "" };
  }

  const hintsDescription = Object.entries(hints)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: "${v}"`)
    .join(", ");

  const prompt = [
    "You are a browser automation expert. A Playwright selector failed to find an element on this page.",
    "",
    `Action: ${step.action}`,
    `Step title: ${step.title}`,
    `Original selectors (all failed): ${(step.selectorVariants ?? []).join(", ")}`,
    hintsDescription ? `Known attributes: ${hintsDescription}` : "",
    "",
    "Here is the page HTML:",
    "```html",
    truncateHtml(html),
    "```",
    "",
    "Find the target element and suggest up to 3 CSS selectors that would match it.",
    "Output ONLY the selectors, one per line, wrapped in backticks. No explanation.",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await runLocalClaude(prompt, llmCommand);
  if (!response) return { healed: false, newSelectors: [], strategy: "" };

  const candidates = parseSelectorsFromLlmResponse(response);

  for (const selector of candidates) {
    if (await isLocatable(page, selector)) {
      return { healed: true, newSelectors: [selector], strategy: "llm" };
    }
  }

  return { healed: false, newSelectors: [], strategy: "" };
};

export const healSelector = async (
  page: Page,
  step: RecipeStep,
  llmCommand = "claude",
): Promise<HealResult> => {
  const hints = collectHints(step.selectorVariants ?? []);

  const heuristicResult = await tryHeuristicHeal(page, step, hints);
  if (heuristicResult.healed) return heuristicResult;

  return tryLlmHeal(page, step, hints, llmCommand);
};
