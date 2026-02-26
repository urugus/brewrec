import { eventsToCompileResult } from "../core/compile-heuristic.js";
import { exists, recipePath } from "../core/fs.js";
import { runLocalClaude } from "../core/llm.js";
import { loadRecipe, saveRecipe } from "../core/recipe-store.js";
import { readRecordedEvents } from "../core/record-store.js";
import type { Recipe, RecordedEvent } from "../types.js";

type CompileOptions = {
  llmCommand?: string;
};

function buildPrompt(events: RecordedEvent[]): string {
  const sample = events.slice(0, 40);
  return [
    "You are compiling browser actions to robust recipe intents.",
    "Summarize user intent in Japanese as short bullet list.",
    JSON.stringify(sample),
  ].join("\n\n");
}

export async function compileCommand(name: string, options: CompileOptions): Promise<void> {
  const events = await readRecordedEvents(name);
  const { steps, stats } = eventsToCompileResult(events);

  const llmSummary = await runLocalClaude(buildPrompt(events), options.llmCommand);
  const p = recipePath(name);

  let version = 1;
  if (await exists(p)) {
    const prev = await loadRecipe(name);
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
    fallback: {
      selectorReSearch: true,
      selectorVariants: steps.flatMap((s) => s.selectorVariants ?? []).slice(0, 20),
      allowRepair: true,
    },
    notes,
  };

  await saveRecipe(recipe);
}
