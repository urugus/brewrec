import type { Recipe } from "../types.js";

const STEP_ACTIONS = new Set([
  "goto",
  "click",
  "fill",
  "press",
  "fetch",
  "extract",
  "ensure_login",
]);

const STEP_MODES = new Set(["http", "pw"]);
const RECIPE_SOURCES = new Set(["compiled", "repaired", "healed"]);
const GUARD_TYPES = new Set(["url_not", "url_is", "text_visible"]);
const EFFECT_TYPES = new Set(["url_changed", "text_visible", "min_items"]);
const RESOLVER_TYPES = new Set(["cli", "builtin", "prompted", "secret"]);
const VARIABLE_TYPES = new Set(["string", "date"]);
const HTTP_DISALLOWED_ACTIONS = new Set(["goto", "click", "fill", "press"]);

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
};

const isOptionalString = (value: unknown): boolean => {
  return value === undefined || typeof value === "string";
};

const isOptionalBoolean = (value: unknown): boolean => {
  return value === undefined || typeof value === "boolean";
};

const hasOnlyStringValues = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
};

const isValidGuardArray = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((guard) => {
    return (
      isObject(guard) && GUARD_TYPES.has(String(guard.type)) && typeof guard.value === "string"
    );
  });
};

const isValidEffectArray = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((effect) => {
    return (
      isObject(effect) && EFFECT_TYPES.has(String(effect.type)) && typeof effect.value === "string"
    );
  });
};

const isValidStep = (step: unknown): boolean => {
  if (!isObject(step)) return false;
  if (typeof step.id !== "string") return false;
  if (typeof step.title !== "string") return false;

  const mode = String(step.mode);
  const action = String(step.action);
  if (!STEP_MODES.has(mode)) return false;
  if (!STEP_ACTIONS.has(action)) return false;

  if (!isOptionalString(step.url)) return false;
  if (!isOptionalString(step.method)) return false;
  if (!isOptionalString(step.body)) return false;
  if (!isOptionalBoolean(step.download)) return false;
  if (!isOptionalString(step.value)) return false;
  if (!isOptionalString(step.key)) return false;
  if (step.selectorVariants !== undefined && !isStringArray(step.selectorVariants)) return false;
  if (step.fallbackStepIds !== undefined && !isStringArray(step.fallbackStepIds)) return false;
  if (step.headers !== undefined && !hasOnlyStringValues(step.headers)) return false;
  if (!isValidGuardArray(step.guards)) return false;
  if (!isValidEffectArray(step.effects)) return false;

  if (mode === "http" && HTTP_DISALLOWED_ACTIONS.has(action)) return false;

  if (action === "click" || action === "fill") {
    if (!isStringArray(step.selectorVariants) || step.selectorVariants.length === 0) return false;
  }
  if (action === "fill") {
    if (typeof step.value !== "string" || step.value.length === 0) return false;
  }
  if (action === "press") {
    if (typeof step.key !== "string" || step.key.length === 0) return false;
  }
  if (action === "goto" || action === "fetch") {
    if (typeof step.url !== "string" || step.url.length === 0) return false;
  }

  return true;
};

const isValidVariableResolver = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (!isObject(value)) return false;
  return RESOLVER_TYPES.has(String(value.type));
};

const isValidVariable = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  if (typeof value.name !== "string") return false;
  if (!isOptionalString(value.description)) return false;
  if (!isOptionalBoolean(value.required)) return false;
  if (!isOptionalString(value.defaultValue)) return false;
  if (!isOptionalString(value.pattern)) return false;
  if (value.type !== undefined && !VARIABLE_TYPES.has(String(value.type))) return false;
  if (!isValidVariableResolver(value.resolver)) return false;
  return true;
};

const isValidFallback = (value: unknown): boolean => {
  if (!isObject(value)) return false;
  if (typeof value.selectorReSearch !== "boolean") return false;
  if (!isStringArray(value.selectorVariants)) return false;
  if (typeof value.allowRepair !== "boolean") return false;
  return true;
};

export const isValidRecipe = (value: unknown): value is Recipe => {
  if (!isObject(value)) return false;
  if (typeof value.schemaVersion !== "number") return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.version !== "number") return false;
  if (typeof value.createdAt !== "string") return false;
  if (typeof value.updatedAt !== "string") return false;
  if (!RECIPE_SOURCES.has(String(value.source))) return false;
  if (!Array.isArray(value.steps) || !value.steps.every((step) => isValidStep(step))) return false;
  if (!isValidFallback(value.fallback)) return false;
  if (!isOptionalString(value.downloadDir)) return false;
  if (!isOptionalString(value.notes)) return false;
  if (value.variables !== undefined) {
    if (!Array.isArray(value.variables)) return false;
    if (!value.variables.every((variable) => isValidVariable(variable))) return false;
  }
  return true;
};
