import type { Page } from "playwright";
import type { Effect, Guard, RecipeStep } from "../types.js";

type GuardContext = {
  currentUrl?: string;
  page?: Page;
};

type EffectContext = {
  beforeUrl?: string;
  currentUrl?: string;
  page?: Page;
};

function matchesUrl(pattern: string, currentUrl: string): boolean {
  if (pattern.endsWith("*")) {
    return currentUrl.startsWith(pattern.slice(0, -1));
  }
  return currentUrl === pattern;
}

async function evaluateGuard(guard: Guard, context: GuardContext): Promise<boolean> {
  const currentUrl = context.currentUrl;

  if (guard.type === "url_is") {
    return currentUrl ? matchesUrl(guard.value, currentUrl) : true;
  }

  if (guard.type === "url_not") {
    return currentUrl ? !matchesUrl(guard.value, currentUrl) : true;
  }

  if (guard.type === "text_visible") {
    if (!context.page) return true;
    try {
      return await context.page.getByText(guard.value).first().isVisible({ timeout: 1200 });
    } catch {
      return false;
    }
  }

  return true;
}

function parseMinItems(value: string): { selector: string; count: number } | null {
  const [selector, rawCount] = value.split("|");
  if (!selector || !rawCount) return null;

  const count = Number(rawCount);
  if (!Number.isFinite(count) || count < 0) return null;

  return { selector, count };
}

async function evaluateEffect(effect: Effect, context: EffectContext): Promise<boolean> {
  if (effect.type === "url_changed") {
    if (!context.currentUrl) return true;
    if (effect.value) return context.currentUrl === effect.value;
    return context.beforeUrl !== context.currentUrl;
  }

  if (effect.type === "text_visible") {
    if (!context.page) return true;
    try {
      return await context.page.getByText(effect.value).first().isVisible({ timeout: 2000 });
    } catch {
      return false;
    }
  }

  if (effect.type === "min_items") {
    if (!context.page) return true;
    const parsed = parseMinItems(effect.value);
    if (!parsed) return true;

    try {
      const count = await context.page.locator(parsed.selector).count();
      return count >= parsed.count;
    } catch {
      return false;
    }
  }

  return true;
}

export async function assertGuards(step: RecipeStep, context: GuardContext): Promise<void> {
  for (const guard of step.guards ?? []) {
    const ok = await evaluateGuard(guard, context);
    if (!ok) {
      throw new Error(`Guard failed: ${guard.type}=${guard.value} (step=${step.id})`);
    }
  }
}

export async function assertEffects(step: RecipeStep, context: EffectContext): Promise<void> {
  for (const effect of step.effects ?? []) {
    const ok = await evaluateEffect(effect, context);
    if (!ok) {
      throw new Error(`Effect failed: ${effect.type}=${effect.value} (step=${step.id})`);
    }
  }
}
