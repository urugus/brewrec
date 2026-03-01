import { ResultAsync, errAsync, okAsync } from "neverthrow";
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

export type StepValidationError = {
  kind: "guard_failed" | "effect_failed";
  stepId: string;
  checkType: string;
  value: string;
};

export const formatStepValidationError = (error: StepValidationError): string => {
  if (error.kind === "guard_failed") {
    return `Guard failed: ${error.checkType}=${error.value} (step=${error.stepId})`;
  }
  return `Effect failed: ${error.checkType}=${error.value} (step=${error.stepId})`;
};

const guardFailed = (step: RecipeStep, guard: Guard): StepValidationError => {
  return {
    kind: "guard_failed",
    stepId: step.id,
    checkType: guard.type,
    value: guard.value,
  };
};

const effectFailed = (step: RecipeStep, effect: Effect): StepValidationError => {
  return {
    kind: "effect_failed",
    stepId: step.id,
    checkType: effect.type,
    value: effect.value,
  };
};

export const matchesUrl = (pattern: string, currentUrl: string): boolean => {
  if (pattern.endsWith("*")) {
    return currentUrl.startsWith(pattern.slice(0, -1));
  }
  return currentUrl === pattern;
};

const evaluateGuard = async (guard: Guard, context: GuardContext): Promise<boolean> => {
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
      await context.page
        .getByText(guard.value)
        .first()
        .waitFor({ state: "visible", timeout: 1200 });
      return true;
    } catch {
      return false;
    }
  }

  return true;
};

const parseMinItems = (value: string): { selector: string; count: number } | null => {
  const [selector, rawCount] = value.split("|");
  if (!selector || !rawCount) return null;

  const count = Number(rawCount);
  if (!Number.isFinite(count) || count < 0) return null;

  return { selector, count };
};

const evaluateEffect = async (effect: Effect, context: EffectContext): Promise<boolean> => {
  if (effect.type === "url_changed") {
    if (!context.currentUrl) return true;
    if (effect.value) return context.currentUrl === effect.value;
    return context.beforeUrl !== context.currentUrl;
  }

  if (effect.type === "text_visible") {
    if (!context.page) return true;
    try {
      await context.page
        .getByText(effect.value)
        .first()
        .waitFor({ state: "visible", timeout: 2000 });
      return true;
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
};

export const validateGuards = (
  step: RecipeStep,
  context: GuardContext,
): ResultAsync<void, StepValidationError> => {
  let result: ResultAsync<void, StepValidationError> = okAsync(undefined);

  for (const guard of step.guards ?? []) {
    result = result.andThen(() =>
      ResultAsync.fromPromise(evaluateGuard(guard, context), () =>
        guardFailed(step, guard),
      ).andThen((ok) => {
        if (!ok) return errAsync(guardFailed(step, guard));
        return okAsync(undefined);
      }),
    );
  }

  return result;
};

export const validateEffects = (
  step: RecipeStep,
  context: EffectContext,
): ResultAsync<void, StepValidationError> => {
  let result: ResultAsync<void, StepValidationError> = okAsync(undefined);

  for (const effect of step.effects ?? []) {
    result = result.andThen(() =>
      ResultAsync.fromPromise(evaluateEffect(effect, context), () =>
        effectFailed(step, effect),
      ).andThen((ok) => {
        if (!ok) return errAsync(effectFailed(step, effect));
        return okAsync(undefined);
      }),
    );
  }

  return result;
};

export const assertGuards = async (step: RecipeStep, context: GuardContext): Promise<void> => {
  const result = await validateGuards(step, context);
  if (result.isErr()) {
    throw new Error(formatStepValidationError(result.error));
  }
};

export const assertEffects = async (step: RecipeStep, context: EffectContext): Promise<void> => {
  const result = await validateEffects(step, context);
  if (result.isErr()) {
    throw new Error(formatStepValidationError(result.error));
  }
};
