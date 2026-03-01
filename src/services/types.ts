import type { ExecutionPlan } from "../core/execution-plan.js";
import type { Recipe } from "../types.js";

export type ServiceError = {
  code: string;
  message: string;
};

export type CompileResult = {
  recipe: Recipe;
};

export type PlanResult = {
  name: string;
  version: number;
  plan: ExecutionPlan;
};

export type RunResult = {
  name: string;
  version: number;
  ok: boolean;
  phase: "plan" | "execute";
  resolvedVars?: Record<string, string>;
  warnings?: string[];
  error?: string;
};

export type RepairResult = {
  recipe: Recipe;
};

export type RecipeSummary = {
  id: string;
  version: number;
  updatedAt: string;
  steps: number;
};

export type ListResult = {
  recipes: RecipeSummary[];
};
