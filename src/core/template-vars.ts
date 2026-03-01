import { type Result, err, ok } from "neverthrow";
import type { Effect, Guard, RecipeStep } from "../types.js";

export type TemplateContext = {
  vars?: Record<string, string>;
  now?: Date;
};

export type TemplateVarError =
  | {
      kind: "invalid_day_offset";
      rawOffset: string;
    }
  | {
      kind: "unknown_template_variable";
      token: string;
    }
  | {
      kind: "invalid_cli_var_format";
      item: string;
    }
  | {
      kind: "invalid_cli_var_key";
      item: string;
    };

export const formatTemplateVarError = (error: TemplateVarError): string => {
  if (error.kind === "invalid_day_offset") {
    return `Invalid day offset: ${error.rawOffset}`;
  }
  if (error.kind === "unknown_template_variable") {
    return `Unknown template variable: ${error.token}`;
  }
  if (error.kind === "invalid_cli_var_format") {
    return `Invalid --var format: ${error.item}. Use --var key=value`;
  }
  return `Invalid --var key in: ${error.item}`;
};

const TEMPLATE_PATTERN = /{{\s*([^{}]+?)\s*}}/g;
const TODAY_PATTERN = /^today([+-]\d+d)?$/;

const pad = (value: number): string => {
  return String(value).padStart(2, "0");
};

const formatDate = (date: Date): string => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const applyDayOffsetResult = (base: Date, rawOffset?: string): Result<Date, TemplateVarError> => {
  if (!rawOffset) return ok(base);
  const sign = rawOffset.startsWith("-") ? -1 : 1;
  const numeric = Number(rawOffset.slice(1, -1));
  if (!Number.isFinite(numeric)) {
    return err({ kind: "invalid_day_offset", rawOffset });
  }

  const date = new Date(base);
  date.setDate(date.getDate() + sign * numeric);
  return ok(date);
};

const resolveTokenResult = (
  token: string,
  context: TemplateContext,
): Result<string, TemplateVarError> => {
  const fromVars = context.vars?.[token];
  if (fromVars !== undefined) return ok(fromVars);

  if (token === "now") {
    return ok((context.now ?? new Date()).toISOString());
  }

  const todayMatch = token.match(TODAY_PATTERN);
  if (todayMatch) {
    const now = context.now ?? new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return applyDayOffsetResult(base, todayMatch[1]).map((date) => formatDate(date));
  }

  return err({ kind: "unknown_template_variable", token });
};

export const isBuiltinTemplateToken = (token: string): boolean => {
  return token === "now" || TODAY_PATTERN.test(token);
};

export const listTemplateTokens = (value: string): string[] => {
  const tokens = new Set<string>();
  for (const match of value.matchAll(TEMPLATE_PATTERN)) {
    const raw = match[1];
    if (!raw) continue;
    tokens.add(raw.trim());
  }
  return [...tokens];
};

export const resolveTemplateStringResult = (
  value: string,
  context: TemplateContext = {},
): Result<string, TemplateVarError> => {
  let resolved = "";
  let lastIndex = 0;

  for (const match of value.matchAll(TEMPLATE_PATTERN)) {
    const rawToken = match[1];
    if (rawToken === undefined) continue;

    const fullMatch = match[0] ?? "";
    const index = match.index ?? 0;
    resolved += value.slice(lastIndex, index);

    const tokenResult = resolveTokenResult(String(rawToken).trim(), context);
    if (tokenResult.isErr()) return err(tokenResult.error);

    resolved += tokenResult.value;
    lastIndex = index + fullMatch.length;
  }

  resolved += value.slice(lastIndex);
  return ok(resolved);
};

export const resolveTemplateString = (value: string, context: TemplateContext = {}): string => {
  const result = resolveTemplateStringResult(value, context);
  if (result.isErr()) {
    throw new Error(formatTemplateVarError(result.error));
  }
  return result.value;
};

const resolveGuardResult = (
  guard: Guard,
  context: TemplateContext,
): Result<Guard, TemplateVarError> => {
  return resolveTemplateStringResult(guard.value, context).map((value) => ({ ...guard, value }));
};

const resolveEffectResult = (
  effect: Effect,
  context: TemplateContext,
): Result<Effect, TemplateVarError> => {
  return resolveTemplateStringResult(effect.value, context).map((value) => ({ ...effect, value }));
};

export const resolveRecipeStepTemplatesResult = (
  step: RecipeStep,
  context: TemplateContext = {},
): Result<RecipeStep, TemplateVarError> => {
  const urlResult = step.url ? resolveTemplateStringResult(step.url, context) : ok(step.url);
  if (urlResult.isErr()) return err(urlResult.error);

  const valueResult =
    step.value !== undefined ? resolveTemplateStringResult(step.value, context) : ok(step.value);
  if (valueResult.isErr()) return err(valueResult.error);

  let selectorVariants: string[] | undefined;
  if (step.selectorVariants) {
    const resolvedSelectors: string[] = [];
    for (const selector of step.selectorVariants) {
      const selectorResult = resolveTemplateStringResult(selector, context);
      if (selectorResult.isErr()) return err(selectorResult.error);
      resolvedSelectors.push(selectorResult.value);
    }
    selectorVariants = resolvedSelectors;
  }

  let guards: Guard[] | undefined;
  if (step.guards) {
    const resolvedGuards: Guard[] = [];
    for (const guard of step.guards) {
      const guardResult = resolveGuardResult(guard, context);
      if (guardResult.isErr()) return err(guardResult.error);
      resolvedGuards.push(guardResult.value);
    }
    guards = resolvedGuards;
  }

  let effects: Effect[] | undefined;
  if (step.effects) {
    const resolvedEffects: Effect[] = [];
    for (const effect of step.effects) {
      const effectResult = resolveEffectResult(effect, context);
      if (effectResult.isErr()) return err(effectResult.error);
      resolvedEffects.push(effectResult.value);
    }
    effects = resolvedEffects;
  }

  return ok({
    ...step,
    url: urlResult.value,
    value: valueResult.value,
    selectorVariants,
    guards,
    effects,
  });
};

export const resolveRecipeStepTemplates = (
  step: RecipeStep,
  context: TemplateContext = {},
): RecipeStep => {
  const result = resolveRecipeStepTemplatesResult(step, context);
  if (result.isErr()) {
    throw new Error(formatTemplateVarError(result.error));
  }
  return result.value;
};

export const parseCliVariablesResult = (
  raw: string[],
): Result<Record<string, string>, TemplateVarError> => {
  const vars: Record<string, string> = {};

  for (const item of raw) {
    const index = item.indexOf("=");
    if (index <= 0 || index === item.length - 1) {
      return err({ kind: "invalid_cli_var_format", item });
    }

    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1);
    if (!key) {
      return err({ kind: "invalid_cli_var_key", item });
    }
    vars[key] = value;
  }

  return ok(vars);
};

export const parseCliVariables = (raw: string[]): Record<string, string> => {
  const result = parseCliVariablesResult(raw);
  if (result.isErr()) {
    throw new Error(formatTemplateVarError(result.error));
  }
  return result.value;
};

export const collectStepTemplateTokens = (step: RecipeStep): string[] => {
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
};
