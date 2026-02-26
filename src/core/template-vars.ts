import type { Effect, Guard, RecipeStep } from "../types.js";

export type TemplateContext = {
  vars?: Record<string, string>;
  now?: Date;
};

const TEMPLATE_PATTERN = /{{\s*([^{}]+?)\s*}}/g;
const TODAY_PATTERN = /^today([+-]\d+d)?$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function applyDayOffset(base: Date, rawOffset?: string): Date {
  if (!rawOffset) return base;
  const sign = rawOffset.startsWith("-") ? -1 : 1;
  const numeric = Number(rawOffset.slice(1, -1));
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid day offset: ${rawOffset}`);
  }

  const date = new Date(base);
  date.setDate(date.getDate() + sign * numeric);
  return date;
}

function resolveToken(token: string, context: TemplateContext): string {
  const fromVars = context.vars?.[token];
  if (fromVars !== undefined) return fromVars;

  if (token === "now") {
    return (context.now ?? new Date()).toISOString();
  }

  const todayMatch = token.match(TODAY_PATTERN);
  if (todayMatch) {
    const now = context.now ?? new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return formatDate(applyDayOffset(base, todayMatch[1]));
  }

  throw new Error(`Unknown template variable: ${token}`);
}

export function isBuiltinTemplateToken(token: string): boolean {
  return token === "now" || TODAY_PATTERN.test(token);
}

export function listTemplateTokens(value: string): string[] {
  const tokens = new Set<string>();
  for (const match of value.matchAll(TEMPLATE_PATTERN)) {
    const raw = match[1];
    if (!raw) continue;
    tokens.add(raw.trim());
  }
  return [...tokens];
}

export function resolveTemplateString(value: string, context: TemplateContext = {}): string {
  return value.replace(TEMPLATE_PATTERN, (_full, token) =>
    resolveToken(String(token).trim(), context),
  );
}

function resolveGuard(guard: Guard, context: TemplateContext): Guard {
  return { ...guard, value: resolveTemplateString(guard.value, context) };
}

function resolveEffect(effect: Effect, context: TemplateContext): Effect {
  return { ...effect, value: resolveTemplateString(effect.value, context) };
}

export function resolveRecipeStepTemplates(
  step: RecipeStep,
  context: TemplateContext = {},
): RecipeStep {
  return {
    ...step,
    url: step.url ? resolveTemplateString(step.url, context) : step.url,
    value: step.value !== undefined ? resolveTemplateString(step.value, context) : step.value,
    selectorVariants: step.selectorVariants?.map((selector) =>
      resolveTemplateString(selector, context),
    ),
    guards: step.guards?.map((guard) => resolveGuard(guard, context)),
    effects: step.effects?.map((effect) => resolveEffect(effect, context)),
  };
}

export function parseCliVariables(raw: string[]): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const item of raw) {
    const index = item.indexOf("=");
    if (index <= 0 || index === item.length - 1) {
      throw new Error(`Invalid --var format: ${item}. Use --var key=value`);
    }

    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1);
    if (!key) {
      throw new Error(`Invalid --var key in: ${item}`);
    }
    vars[key] = value;
  }

  return vars;
}

export function collectStepTemplateTokens(step: RecipeStep): string[] {
  const tokens = new Set<string>();

  const collect = (value?: string): void => {
    if (!value) return;
    for (const token of listTemplateTokens(value)) {
      tokens.add(token);
    }
  };

  collect(step.url);
  collect(step.value);
  for (const selector of step.selectorVariants ?? []) collect(selector);
  for (const guard of step.guards ?? []) collect(guard.value);
  for (const effect of step.effects ?? []) collect(effect.value);

  return [...tokens];
}
