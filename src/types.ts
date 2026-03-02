import type { z } from "zod";
import type {
  effectSchema,
  fallbackPlanSchema,
  guardSchema,
  recipeSchema,
  recipeStepSchema,
  recipeVariableSchema,
  variableResolverSchema,
} from "./recipe-schema.js";

export type RecordedEventType =
  | "navigation"
  | "click"
  | "input"
  | "keypress"
  | "request"
  | "response"
  | "console";

export type DomAnchors = {
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  nearbyText?: string[];
  css?: string;
  xpath?: string;
  selectorVariants: string[];
};

export type Guard = z.infer<typeof guardSchema>;

export type Effect = z.infer<typeof effectSchema>;

export type RecordedEvent = {
  ts: string;
  type: RecordedEventType;
  url: string;
  intent?: string;
  anchors?: DomAnchors;
  guards?: Guard[];
  effects?: Effect[];
  value?: string;
  key?: string;
  method?: string;
  status?: number;
  requestUrl?: string;
  responseUrl?: string;
  headers?: Record<string, string>;
  postData?: string;
  secret?: boolean;
  secretFieldName?: string;
};

export type RecipeStep = z.infer<typeof recipeStepSchema>;
export type StepMode = RecipeStep["mode"];
export type FallbackPlan = z.infer<typeof fallbackPlanSchema>;
export type VariableResolver = z.infer<typeof variableResolverSchema>;
export type RecipeVariable = z.infer<typeof recipeVariableSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
