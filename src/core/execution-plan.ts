import { type Result, err, ok } from "neverthrow";
import type { Recipe, RecipeStep, RecipeVariable } from "../types.js";
import { runLocalClaude } from "./llm.js";
import {
  type SecretStoreError,
  formatSecretStoreError,
  loadSecretResult,
  saveSecretResult,
} from "./secret-store.js";
import {
  type TemplateVarError,
  collectStepTemplateTokens,
  formatTemplateVarError,
  isBuiltinTemplateToken,
  resolveRecipeStepTemplatesResult,
  resolveTemplateStringResult,
} from "./template-vars.js";

export type ExecutionPlan = {
  now: string;
  resolvedVars: Record<string, string>;
  unresolvedVars: string[];
  warnings: string[];
  steps: RecipeStep[];
};

type PromptRunner = (prompt: string, command?: string) => Promise<string>;
type SecretLoaderResult = Result<string | undefined, SecretStoreError>;
type SecretSaverResult = Result<void, SecretStoreError>;

export type BuildExecutionPlanOptions = {
  cliVars?: Record<string, string>;
  now?: Date;
  llmCommand?: string;
  promptRunner?: PromptRunner;
  secretLoader?: SecretLoader;
  secretSaver?: SecretSaver;
};

export type BuildExecutionPlanError =
  | {
      kind: "variable_validation_failed";
      variableName: string;
      message: string;
    }
  | {
      kind: "template_error";
      phase: "resolver_builtin" | "resolver_prompt" | "step_resolution";
      error: TemplateVarError;
      variableName?: string;
      stepId?: string;
    }
  | {
      kind: "unexpected_error";
      phase: "secret_loader" | "prompt_runner" | "secret_saver";
      variableName: string;
      message: string;
    }
  | {
      kind: "secret_store_error";
      phase: "secret_loader" | "secret_saver";
      variableName: string;
      error: SecretStoreError;
    };

export const formatBuildExecutionPlanError = (error: BuildExecutionPlanError): string => {
  if (error.kind === "variable_validation_failed") {
    return error.message;
  }

  if (error.kind === "template_error") {
    const base = formatTemplateVarError(error.error);
    if (error.phase === "step_resolution" && error.stepId) {
      return `Step ${error.stepId}: ${base}`;
    }
    return base;
  }

  if (error.kind === "secret_store_error") {
    return `Secret store failed (${error.phase}, ${error.variableName}): ${formatSecretStoreError(error.error)}`;
  }

  return `Unexpected execution plan error: phase=${error.phase}, variable=${error.variableName}: ${error.message}`;
};

const isDateValue = (value: string): boolean => {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
};

const validateResolvedVariableResult = (
  variable: RecipeVariable,
  value: string,
): Result<void, BuildExecutionPlanError> => {
  if (variable.type === "date" && !isDateValue(value)) {
    return err({
      kind: "variable_validation_failed",
      variableName: variable.name,
      message: `Variable ${variable.name} must be date format YYYY-MM-DD`,
    });
  }

  if (variable.pattern) {
    const pattern = new RegExp(variable.pattern);
    if (!pattern.test(value)) {
      return err({
        kind: "variable_validation_failed",
        variableName: variable.name,
        message: `Variable ${variable.name} does not match pattern: ${variable.pattern}`,
      });
    }
  }

  return ok(undefined);
};

const pickPromptValue = (output: string): string => {
  const firstNonEmpty = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstNonEmpty ?? "";
};

type SecretLoader = (
  recipeName: string,
  variableName: string,
) => Promise<string | undefined | SecretLoaderResult>;
type SecretSaver = (
  recipeName: string,
  variableName: string,
  plaintext: string,
) => Promise<undefined | SecretSaverResult>;

const causeMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  return String(cause);
};

const isResultLike = <T, E>(value: unknown): value is Result<T, E> => {
  return typeof value === "object" && value !== null && "isErr" in value && "isOk" in value;
};

const normalizeSecretLoaderResult = (
  value: string | undefined | SecretLoaderResult,
): SecretLoaderResult => {
  if (isResultLike<string | undefined, SecretStoreError>(value)) return value;
  return ok(value);
};

const normalizeSecretSaverResult = (value: undefined | SecretSaverResult): SecretSaverResult => {
  if (isResultLike<void, SecretStoreError>(value)) return value;
  return ok(undefined);
};

const resolveVariableBySpecResult = async (
  variable: RecipeVariable,
  resolvedVars: Record<string, string>,
  context: {
    now: Date;
    recipeId: string;
    llmCommand?: string;
    promptRunner: PromptRunner;
    secretLoader: SecretLoader;
  },
): Promise<Result<string | undefined, BuildExecutionPlanError>> => {
  const resolver = variable.resolver;

  if (!resolver || resolver.type === "cli") {
    const key = resolver?.key;
    if (key) return ok(resolvedVars[key]);
    return ok(resolvedVars[variable.name]);
  }

  if (resolver.type === "builtin") {
    const builtinResult = resolveTemplateStringResult(`{{${resolver.expr}}}`, {
      vars: resolvedVars,
      now: context.now,
    });
    if (builtinResult.isErr()) {
      return err({
        kind: "template_error",
        phase: "resolver_builtin",
        variableName: variable.name,
        error: builtinResult.error,
      });
    }
    return ok(builtinResult.value);
  }

  if (resolver.type === "secret") {
    try {
      const loaderResult = normalizeSecretLoaderResult(
        await context.secretLoader(context.recipeId, variable.name),
      );
      if (loaderResult.isErr()) {
        return err({
          kind: "secret_store_error",
          phase: "secret_loader",
          variableName: variable.name,
          error: loaderResult.error,
        });
      }
      return ok(loaderResult.value);
    } catch (cause) {
      return err({
        kind: "unexpected_error",
        phase: "secret_loader",
        variableName: variable.name,
        message: causeMessage(cause),
      });
    }
  }

  const promptResult = resolveTemplateStringResult(resolver.promptTemplate, {
    vars: resolvedVars,
    now: context.now,
  });
  if (promptResult.isErr()) {
    return err({
      kind: "template_error",
      phase: "resolver_prompt",
      variableName: variable.name,
      error: promptResult.error,
    });
  }

  let output = "";
  try {
    output = await context.promptRunner(promptResult.value, context.llmCommand);
  } catch (cause) {
    return err({
      kind: "unexpected_error",
      phase: "prompt_runner",
      variableName: variable.name,
      message: causeMessage(cause),
    });
  }

  const value = pickPromptValue(output);
  if (!value) return ok(undefined);
  return ok(value);
};

export const buildExecutionPlanResult = async (
  recipe: Recipe,
  options: BuildExecutionPlanOptions = {},
): Promise<Result<ExecutionPlan, BuildExecutionPlanError>> => {
  const now = options.now ?? new Date();
  const promptRunner = options.promptRunner ?? runLocalClaude;
  const secretLoaderFn =
    options.secretLoader ??
    (async (recipeName: string, variableName: string): Promise<SecretLoaderResult> =>
      loadSecretResult(recipeName, variableName));
  const secretSaverFn =
    options.secretSaver ??
    (async (
      recipeName: string,
      variableName: string,
      plaintext: string,
    ): Promise<SecretSaverResult> => saveSecretResult(recipeName, variableName, plaintext));
  const resolvedVars: Record<string, string> = { ...(options.cliVars ?? {}) };
  const warnings: string[] = [];
  const unresolvedVars = new Set<string>();

  for (const variable of recipe.variables ?? []) {
    const preResolved = resolvedVars[variable.name];
    if (preResolved !== undefined) {
      const validationResult = validateResolvedVariableResult(variable, preResolved);
      if (validationResult.isErr()) return err(validationResult.error);
      continue;
    }

    const resolvedResult = await resolveVariableBySpecResult(variable, resolvedVars, {
      now,
      recipeId: recipe.id,
      llmCommand: options.llmCommand,
      promptRunner,
      secretLoader: secretLoaderFn,
    });
    if (resolvedResult.isErr()) return err(resolvedResult.error);

    const finalValue = resolvedResult.value ?? variable.defaultValue;
    if (finalValue !== undefined) {
      const validationResult = validateResolvedVariableResult(variable, finalValue);
      if (validationResult.isErr()) return err(validationResult.error);
      resolvedVars[variable.name] = finalValue;
      continue;
    }

    if (variable.required) {
      unresolvedVars.add(variable.name);
      warnings.push(`Required variable is unresolved: ${variable.name}`);
    }
  }

  for (const variable of recipe.variables ?? []) {
    if (variable.resolver?.type === "secret" && resolvedVars[variable.name] !== undefined) {
      try {
        const saveResult = normalizeSecretSaverResult(
          await secretSaverFn(recipe.id, variable.name, resolvedVars[variable.name]),
        );
        if (saveResult.isErr()) {
          return err({
            kind: "secret_store_error",
            phase: "secret_saver",
            variableName: variable.name,
            error: saveResult.error,
          });
        }
      } catch (cause) {
        return err({
          kind: "unexpected_error",
          phase: "secret_saver",
          variableName: variable.name,
          message: causeMessage(cause),
        });
      }
    }
  }

  for (const step of recipe.steps) {
    for (const token of collectStepTemplateTokens(step)) {
      if (resolvedVars[token] !== undefined) continue;
      if (isBuiltinTemplateToken(token)) continue;
      unresolvedVars.add(token);
    }
  }

  let resolvedSteps = recipe.steps;
  if (unresolvedVars.size === 0) {
    const stepResults: RecipeStep[] = [];
    for (const step of recipe.steps) {
      const resolvedStepResult = resolveRecipeStepTemplatesResult(step, {
        vars: resolvedVars,
        now,
      });
      if (resolvedStepResult.isErr()) {
        return err({
          kind: "template_error",
          phase: "step_resolution",
          stepId: step.id,
          error: resolvedStepResult.error,
        });
      }
      stepResults.push(resolvedStepResult.value);
    }
    resolvedSteps = stepResults;
  }

  return ok({
    now: now.toISOString(),
    resolvedVars,
    unresolvedVars: [...unresolvedVars].sort((a, b) => a.localeCompare(b)),
    warnings,
    steps: resolvedSteps,
  });
};

export const buildExecutionPlan = async (
  recipe: Recipe,
  options: BuildExecutionPlanOptions = {},
): Promise<ExecutionPlan> => {
  const result = await buildExecutionPlanResult(recipe, options);
  if (result.isErr()) {
    throw new Error(formatBuildExecutionPlanError(result.error));
  }
  return result.value;
};
