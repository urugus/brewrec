import { type Result, err, ok } from "neverthrow";
import { eventsToCompileResult } from "../core/compile-heuristic.js";
import { applyCredentialVariables } from "../core/credential-vars.js";
import { exists, recipePath } from "../core/fs.js";
import { formatLocalLlmError, runLocalClaudeResult } from "../core/llm.js";
import {
  formatRecipeStoreError,
  loadRecipeResult,
  saveRecipeResult,
} from "../core/recipe-store.js";
import { formatRecordStoreError, readRecordedEventsResult } from "../core/record-store.js";
import type { Recipe, RecordedEvent } from "../types.js";
import { nullReporter } from "./progress.js";
import type { ProgressReporter } from "./progress.js";
import type { CompileResult, ServiceError } from "./types.js";

export type CompileServiceOptions = {
  llmCommand?: string;
  progress?: ProgressReporter;
};

const buildPrompt = (events: RecordedEvent[]): string => {
  const sample = events.slice(0, 40);
  return [
    "You are compiling browser actions to robust recipe intents.",
    "Summarize user intent in Japanese as short bullet list.",
    JSON.stringify(sample),
  ].join("\n\n");
};

export const compileServiceResult = async (
  name: string,
  options: CompileServiceOptions = {},
): Promise<Result<CompileResult, ServiceError>> => {
  const progress = options.progress ?? nullReporter;

  const eventsResult = await readRecordedEventsResult(name);
  if (eventsResult.isErr()) {
    return err({
      code: "recording_read_failed",
      message: formatRecordStoreError(eventsResult.error),
    });
  }
  const events = eventsResult.value;

  progress({ type: "info", message: `Compiling ${events.length} events...` });

  const { steps: rawSteps, stats } = eventsToCompileResult(events);
  const { steps, variables: secretVars } = applyCredentialVariables(rawSteps, events);

  const llmSummaryResult = await runLocalClaudeResult(buildPrompt(events), options.llmCommand);
  const llmSummary = llmSummaryResult.isOk() ? llmSummaryResult.value : "";
  if (llmSummaryResult.isErr()) {
    progress({
      type: "warn",
      message: `LLM summary skipped: ${formatLocalLlmError(llmSummaryResult.error)}`,
    });
  }

  const p = recipePath(name);
  let version = 1;
  if (await exists(p)) {
    const prevResult = await loadRecipeResult(name);
    if (prevResult.isErr()) {
      return err({ code: "recipe_load_failed", message: formatRecipeStoreError(prevResult.error) });
    }
    version = prevResult.value.version + 1;
  }

  const now = new Date().toISOString();
  const compileSummary = `Compile stats: httpPromoted=${stats.httpPromoted}, httpSkipped=${stats.httpSkipped}`;
  const notes = llmSummary ? `${llmSummary}\n\n${compileSummary}` : compileSummary;

  const recipe: Recipe = {
    schemaVersion: 1,
    id: name,
    name,
    version,
    createdAt: now,
    updatedAt: now,
    source: "compiled",
    steps,
    variables: secretVars.length > 0 ? secretVars : undefined,
    fallback: {
      selectorReSearch: true,
      selectorVariants: steps.flatMap((s) => s.selectorVariants ?? []).slice(0, 20),
      allowRepair: true,
    },
    notes,
  };

  const saveResult = await saveRecipeResult(recipe);
  if (saveResult.isErr()) {
    return err({ code: "recipe_save_failed", message: formatRecipeStoreError(saveResult.error) });
  }

  progress({ type: "info", message: `Recipe compiled: ${name} v${version}` });
  return ok({ recipe });
};
