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
import type { CommandError } from "./result.js";
import { toCommandError } from "./result.js";

type CompileOptions = {
  llmCommand?: string;
};

const buildPrompt = (events: RecordedEvent[]): string => {
  const sample = events.slice(0, 40);
  return [
    "You are compiling browser actions to robust recipe intents.",
    "Summarize user intent in Japanese as short bullet list.",
    JSON.stringify(sample),
  ].join("\n\n");
};

export const compileCommand = async (name: string, options: CompileOptions): Promise<void> => {
  const result = await compileCommandResult(name, options);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
};

export const compileCommandResult = async (
  name: string,
  options: CompileOptions,
): Promise<Result<void, CommandError>> => {
  try {
    const eventsResult = await readRecordedEventsResult(name);
    if (eventsResult.isErr()) {
      throw new Error(formatRecordStoreError(eventsResult.error));
    }
    const events = eventsResult.value;
    const { steps: rawSteps, stats } = eventsToCompileResult(events);
    const { steps, variables: secretVars } = applyCredentialVariables(rawSteps, events);

    const llmSummaryResult = await runLocalClaudeResult(buildPrompt(events), options.llmCommand);
    const llmSummary = llmSummaryResult.isOk() ? llmSummaryResult.value : "";
    if (llmSummaryResult.isErr()) {
      process.stderr.write(`LLM summary skipped: ${formatLocalLlmError(llmSummaryResult.error)}\n`);
    }

    const p = recipePath(name);

    let version = 1;
    if (await exists(p)) {
      const prevResult = await loadRecipeResult(name);
      if (prevResult.isErr()) {
        throw new Error(formatRecipeStoreError(prevResult.error));
      }
      const prev = prevResult.value;
      version = prev.version + 1;
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
      throw new Error(formatRecipeStoreError(saveResult.error));
    }
    return ok(undefined);
  } catch (cause) {
    return err(toCommandError("compile", cause));
  }
};
