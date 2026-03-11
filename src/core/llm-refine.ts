import { type Result, err, ok } from "neverthrow";
import type { RecipeStep, RecordedEvent } from "../types.js";
import type { LocalLlmError } from "./llm.js";
import { runLocalClaudeResult } from "./llm.js";

type LlmStepPatch = {
  id: string;
  title?: string;
  download?: boolean;
};

const buildEventSummary = (events: RecordedEvent[]): string => {
  const lines: string[] = [];
  const limited = events.slice(0, 60);
  for (const e of limited) {
    if (e.type === "navigation") {
      lines.push(`[nav] ${e.url}`);
    } else if (e.type === "click" && e.anchors) {
      lines.push(
        `[click] "${e.anchors.name ?? ""}" selector=${e.anchors.selectorVariants[0] ?? ""} url=${e.url}`,
      );
    } else if (e.type === "input" && e.anchors) {
      lines.push(`[input] selector=${e.anchors.selectorVariants[0] ?? ""} url=${e.url}`);
    } else if (e.type === "response" && e.responseUrl) {
      const cd = e.headers?.["content-disposition"] ?? "";
      const ct = e.headers?.["content-type"] ?? "";
      lines.push(
        `[response] ${e.responseUrl} status=${e.status ?? "?"} type=${ct}${cd ? ` disposition=${cd}` : ""}`,
      );
    }
  }
  return lines.join("\n");
};

export const buildRefinePrompt = (steps: RecipeStep[], events: RecordedEvent[]): string => {
  return `You are a browser automation recipe optimizer. You are given:
1. A list of compiled recipe steps (JSON)
2. A summary of the raw recorded browser events for context

## Rules
- Remove redundant steps (e.g., duplicate navigations to the same URL in sequence)
- Add "download": true to click steps that trigger a file download (check event summary for content-disposition: attachment responses)
- Improve step titles: replace generic titles like "Navigate", "Click target", "Fill input", "Fetch API" with meaningful Japanese descriptions (e.g., "ログインページへ移動", "メールアドレスを入力", "送信ボタンをクリック")
- Remove steps that don't contribute to the user's apparent intent
- Do NOT change: id, mode, action, url, method, headers, body, selectorVariants, value, key, guards, effects, fallbackStepIds
- Only modify: title and download fields
- Do NOT add new steps or reorder steps
- Preserve all credential variable references ({{varName}} in value fields)

## Output format
Return ONLY a JSON array of objects with these fields: id, title, download (optional).
Steps whose id is omitted from the array will be removed.
No markdown fencing, no explanation. Just the JSON array.

## Steps
${JSON.stringify(steps, null, 2)}

## Event Summary
${buildEventSummary(events)}`;
};

export const parseRefineResponse = (raw: string): Result<LlmStepPatch[], string> => {
  const trimmed = raw.trim();

  // Try direct parse
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return ok(parsed);
  } catch {
    // fall through
  }

  // Try extracting from markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(parsed)) return ok(parsed);
    } catch {
      // fall through
    }
  }

  return err("Failed to parse LLM response as JSON array");
};

export const mergeRefinedSteps = (
  original: RecipeStep[],
  patches: LlmStepPatch[],
): RecipeStep[] => {
  const originalIds = new Set(original.map((s) => s.id));
  const patchMap = new Map<string, LlmStepPatch>();
  for (const p of patches) {
    if (typeof p.id === "string" && originalIds.has(p.id)) {
      patchMap.set(p.id, p);
    }
  }

  // Keep only steps whose id appears in patches
  return original
    .filter((s) => patchMap.has(s.id))
    .map((s) => {
      const patch = patchMap.get(s.id) as LlmStepPatch;
      const updated = { ...s };
      if (typeof patch.title === "string" && patch.title.length > 0) {
        updated.title = patch.title;
      }
      if (patch.download === true) {
        updated.download = true;
      }
      return updated;
    });
};

export const refineStepsWithLlm = async (
  steps: RecipeStep[],
  events: RecordedEvent[],
  llmCommand?: string,
): Promise<Result<RecipeStep[], LocalLlmError>> => {
  const prompt = buildRefinePrompt(steps, events);
  const llmResult = await runLocalClaudeResult(prompt, llmCommand, 180_000);
  if (llmResult.isErr()) return err(llmResult.error);

  const parseResult = parseRefineResponse(llmResult.value);
  if (parseResult.isErr()) {
    return err({
      kind: "command_failed",
      command: llmCommand ?? "claude",
      reason: "unknown",
      code: parseResult.error,
    });
  }

  const refined = mergeRefinedSteps(steps, parseResult.value);
  if (refined.length === 0) {
    // LLM removed all steps — fall back to original
    return ok(steps);
  }

  return ok(refined);
};
