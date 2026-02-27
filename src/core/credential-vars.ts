import type { RecipeStep, RecipeVariable, RecordedEvent } from "../types.js";

export type CredentialVarResult = {
  steps: RecipeStep[];
  variables: RecipeVariable[];
};

export const applyCredentialVariables = (
  steps: RecipeStep[],
  events: RecordedEvent[],
): CredentialVarResult => {
  const variables: RecipeVariable[] = [];
  const seenNames = new Set<string>();

  const secretEventMap = new Map<string, RecordedEvent>();
  for (const event of events) {
    if (event.type === "input" && event.secret && event.secretFieldName && event.anchors) {
      const key = event.anchors.selectorVariants[0];
      if (key) {
        secretEventMap.set(key, event);
      }
    }
  }

  const updatedSteps = steps.map((step) => {
    if (step.action !== "fill") return step;
    if (step.value !== "***") return step;

    const firstSelector = step.selectorVariants?.[0];
    if (!firstSelector) return step;

    const event = secretEventMap.get(firstSelector);
    if (!event?.secretFieldName) return step;

    const varName = event.secretFieldName;
    if (!seenNames.has(varName)) {
      seenNames.add(varName);
      variables.push({
        name: varName,
        required: true,
        resolver: { type: "secret" },
      });
    }

    return { ...step, value: `{{${varName}}}` };
  });

  return { steps: updatedSteps, variables };
};
