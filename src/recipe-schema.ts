import { z } from "zod";

export const RECIPE_SOURCES = ["compiled", "repaired", "healed"] as const;
export const STEP_MODES = ["http", "pw"] as const;
export const STEP_ACTIONS = [
  "goto",
  "click",
  "fill",
  "press",
  "fetch",
  "extract",
  "ensure_login",
] as const;
export const GUARD_TYPES = ["url_not", "url_is", "text_visible"] as const;
export const EFFECT_TYPES = ["url_changed", "text_visible", "min_items"] as const;
export const VARIABLE_TYPES = ["string", "date"] as const;
export const HTTP_DISALLOWED_ACTIONS = ["goto", "click", "fill", "press"];

export const guardSchema = z.object({
  type: z.enum(GUARD_TYPES),
  value: z.string(),
});

export const effectSchema = z.object({
  type: z.enum(EFFECT_TYPES),
  value: z.string(),
});

export const recipeStepSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    mode: z.enum(STEP_MODES),
    action: z.enum(STEP_ACTIONS),
    url: z.string().optional(),
    method: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    download: z.boolean().optional(),
    selectorVariants: z.array(z.string()).optional(),
    value: z.string().optional(),
    key: z.string().optional(),
    guards: z.array(guardSchema).optional(),
    effects: z.array(effectSchema).optional(),
    fallbackStepIds: z.array(z.string()).optional(),
  })
  .superRefine((step, ctx) => {
    if (step.mode === "http" && HTTP_DISALLOWED_ACTIONS.includes(step.action)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `action ${step.action} is not allowed in http mode`,
        path: ["action"],
      });
    }

    if (step.action === "click" || step.action === "fill") {
      if (!step.selectorVariants || step.selectorVariants.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "selectorVariants is required for click/fill",
          path: ["selectorVariants"],
        });
      }
    }

    if (step.action === "fill" && (!step.value || step.value.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "value is required for fill",
        path: ["value"],
      });
    }

    if (step.action === "press" && (!step.key || step.key.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "key is required for press",
        path: ["key"],
      });
    }

    if (
      (step.action === "goto" || step.action === "fetch") &&
      (!step.url || step.url.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "url is required for goto/fetch",
        path: ["url"],
      });
    }
  });

export const fallbackPlanSchema = z.object({
  selectorReSearch: z.boolean(),
  selectorVariants: z.array(z.string()),
  allowRepair: z.boolean(),
});

export const variableResolverSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cli"),
    key: z.string().optional(),
  }),
  z.object({
    type: z.literal("builtin"),
    expr: z.string(),
  }),
  z.object({
    type: z.literal("prompted"),
    promptTemplate: z.string(),
  }),
  z.object({
    type: z.literal("secret"),
  }),
]);

export const recipeVariableSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  type: z.enum(VARIABLE_TYPES).optional(),
  pattern: z.string().optional(),
  defaultValue: z.string().optional(),
  resolver: variableResolverSchema.optional(),
});

export const recipeSchema = z.object({
  schemaVersion: z.number(),
  id: z.string(),
  name: z.string(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  source: z.enum(RECIPE_SOURCES),
  steps: z.array(recipeStepSchema),
  variables: z.array(recipeVariableSchema).optional(),
  fallback: fallbackPlanSchema,
  downloadDir: z.string().optional(),
  notes: z.string().optional(),
});
