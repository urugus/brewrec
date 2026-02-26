import type { Recipe, RecipeStep, RecipeVariable } from "../types.js";
import { runLocalClaude } from "./llm.js";
import {
  collectStepTemplateTokens,
  isBuiltinTemplateToken,
  resolveRecipeStepTemplates,
  resolveTemplateString,
} from "./template-vars.js";

export type ExecutionPlan = {
  now: string;
  resolvedVars: Record<string, string>;
  unresolvedVars: string[];
  warnings: string[];
  steps: RecipeStep[];
};

type PromptRunner = (prompt: string, command?: string) => Promise<string>;

export type BuildExecutionPlanOptions = {
  cliVars?: Record<string, string>;
  now?: Date;
  llmCommand?: string;
  promptRunner?: PromptRunner;
};

const isDateValue = (value: string): boolean => {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
};

const validateResolvedVariable = (variable: RecipeVariable, value: string): void => {
  if (variable.type === "date" && !isDateValue(value)) {
    throw new Error(`Variable ${variable.name} must be date format YYYY-MM-DD`);
  }

  if (variable.pattern) {
    const pattern = new RegExp(variable.pattern);
    if (!pattern.test(value)) {
      throw new Error(`Variable ${variable.name} does not match pattern: ${variable.pattern}`);
    }
  }
};

const pickPromptValue = (output: string): string => {
  const firstNonEmpty = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstNonEmpty ?? "";
};

const resolveVariableBySpec = async (
  variable: RecipeVariable,
  resolvedVars: Record<string, string>,
  context: { now: Date; llmCommand?: string; promptRunner: PromptRunner },
): Promise<string | undefined> => {
  const resolver = variable.resolver;

  if (!resolver || resolver.type === "cli") {
    const key = resolver?.key;
    if (key) return resolvedVars[key];
    return resolvedVars[variable.name];
  }

  if (resolver.type === "builtin") {
    return resolveTemplateString(`{{${resolver.expr}}}`, { vars: resolvedVars, now: context.now });
  }

  const prompt = resolveTemplateString(resolver.promptTemplate, {
    vars: resolvedVars,
    now: context.now,
  });
  const output = await context.promptRunner(prompt, context.llmCommand);
  const value = pickPromptValue(output);
  if (!value) return undefined;
  return value;
};

export const buildExecutionPlan = async (
  recipe: Recipe,
  options: BuildExecutionPlanOptions = {},
): Promise<ExecutionPlan> => {
  const now = options.now ?? new Date();
  const promptRunner = options.promptRunner ?? runLocalClaude;
  const resolvedVars: Record<string, string> = { ...(options.cliVars ?? {}) };
  const warnings: string[] = [];
  const unresolvedVars = new Set<string>();

  for (const variable of recipe.variables ?? []) {
    if (resolvedVars[variable.name] !== undefined) {
      validateResolvedVariable(variable, resolvedVars[variable.name]);
      continue;
    }

    const resolved = await resolveVariableBySpec(variable, resolvedVars, {
      now,
      llmCommand: options.llmCommand,
      promptRunner,
    });

    const finalValue = resolved ?? variable.defaultValue;
    if (finalValue !== undefined) {
      validateResolvedVariable(variable, finalValue);
      resolvedVars[variable.name] = finalValue;
      continue;
    }

    if (variable.required) {
      unresolvedVars.add(variable.name);
      warnings.push(`Required variable is unresolved: ${variable.name}`);
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
    resolvedSteps = recipe.steps.map((step) =>
      resolveRecipeStepTemplates(step, { vars: resolvedVars, now }),
    );
  }

  return {
    now: now.toISOString(),
    resolvedVars,
    unresolvedVars: [...unresolvedVars].sort((a, b) => a.localeCompare(b)),
    warnings,
    steps: resolvedSteps,
  };
};
