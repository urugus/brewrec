import { useCallback, useEffect, useMemo, useState } from "hono/jsx";

type RecipeSummary = {
  id: string;
  steps: number;
  updatedAt: string;
  version: number;
};

type VariableResolver = {
  type: string;
  key?: string;
};

type RecipeVariable = {
  name: string;
  description?: string;
  required?: boolean;
  type?: string;
  defaultValue?: string;
  resolver?: VariableResolver;
};

type PlanStep = {
  id: string;
  title: string;
  mode: string;
  action: string;
  url?: string;
};

type PlanData = {
  name: string;
  version: number;
  plan: {
    now: string;
    resolvedVars: Record<string, string>;
    unresolvedVars: string[];
    warnings: string[];
    steps: PlanStep[];
  };
  downloadDir?: string;
};

type ErrorPayload = {
  error?: string;
};

const asErrorMessage = (value: unknown, fallback: string): string => {
  if (
    value &&
    typeof value === "object" &&
    "error" in value &&
    typeof (value as ErrorPayload).error === "string"
  ) {
    return (value as ErrorPayload).error as string;
  }
  return fallback;
};

const parseJsonSafe = async (res: Response): Promise<unknown> => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const extractVariables = (editorText: string): RecipeVariable[] => {
  try {
    const recipe = JSON.parse(editorText);
    if (Array.isArray(recipe?.variables)) {
      const seen = new Set<string>();
      return (recipe.variables as RecipeVariable[]).filter((v) => {
        if (!v || typeof v.name !== "string" || v.name === "") return false;
        if (seen.has(v.name)) return false;
        seen.add(v.name);
        return true;
      });
    }
  } catch {
    /* ignore */
  }
  return [];
};

/** Return the key used by the backend to resolve a CLI variable. */
const varKey = (v: RecipeVariable): string => {
  return v.resolver?.key ?? v.name;
};

function VarsForm({
  variables,
  vars,
  onVarsChange,
}: {
  variables: RecipeVariable[];
  vars: Record<string, string>;
  onVarsChange: (name: string, value: string) => void;
}) {
  if (variables.length === 0) return null;
  return (
    <div class="vars-form">
      <h3>Variables</h3>
      {variables.map((v) => {
        const key = varKey(v);
        return (
          <div key={v.name} class="var-field">
            <label>
              <span class="var-label-text">
                <span class="var-name">
                  {v.name}
                  {v.required ? " *" : ""}
                </span>
                {v.description ? <span class="var-desc">{v.description}</span> : null}
              </span>
              <input
                type="text"
                value={vars[key] ?? v.defaultValue ?? ""}
                placeholder={v.defaultValue ?? ""}
                onInput={(event) => {
                  const value = (event.target as HTMLInputElement).value;
                  onVarsChange(key, value);
                }}
              />
            </label>
          </div>
        );
      })}
    </div>
  );
}

function PlanResultView({ plan }: { plan: PlanData }) {
  return (
    <div class="plan-result">
      <h3>
        Execution Plan: {plan.name} v{plan.version}
      </h3>
      <div class="plan-meta">
        <span>Generated: {plan.plan.now}</span>
        {plan.downloadDir ? <span>Download dir: {plan.downloadDir}</span> : null}
      </div>
      {Object.keys(plan.plan.resolvedVars).length > 0 ? (
        <div class="plan-vars">
          <h4>Resolved Variables</h4>
          <table>
            <tbody>
              {Object.entries(plan.plan.resolvedVars).map(([k, v]) => (
                <tr key={k}>
                  <td class="var-key">{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {plan.plan.warnings.length > 0 ? (
        <div class="plan-warnings">
          <h4>Warnings</h4>
          <ul>
            {plan.plan.warnings.map((w) => (
              <li key={`warn-${w}`}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div class="plan-steps">
        <h4>Steps ({plan.plan.steps.length})</h4>
        <ol>
          {plan.plan.steps.map((step) => (
            <li key={step.id} class="plan-step">
              <span class="step-badge" data-mode={step.mode}>
                {step.mode}
              </span>
              <span class="step-badge" data-action={step.action}>
                {step.action}
              </span>
              <span class="step-title">{step.title}</span>
              {step.url ? <span class="step-url">{step.url}</span> : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

type RunLogEntry = {
  key: string;
  type: string;
  message: string;
};

type RunResultData = {
  name: string;
  version: number;
  ok: boolean;
  phase: string;
  error?: string;
};

function RunLogView({ logs, result }: { logs: RunLogEntry[]; result: RunResultData | null }) {
  if (logs.length === 0 && !result) return null;
  return (
    <div class={`run-log ${result ? (result.ok ? "run-log-ok" : "run-log-fail") : ""}`}>
      <h3>Run Log</h3>
      {result ? (
        <div class="run-result-summary">
          {result.ok ? "Completed" : "Failed"}
          {" - "}
          {result.name} v{result.version}
          {result.error ? `: ${result.error}` : ""}
        </div>
      ) : null}
      <div class="run-log-entries">
        {logs.map((entry) => (
          <div key={entry.key} class="run-log-entry" data-type={entry.type}>
            {entry.message}
          </div>
        ))}
      </div>
    </div>
  );
}

type RecordLogEntry = {
  key: string;
  type: string;
  message: string;
};

type RecordResultData = {
  name: string;
  eventCount: number;
};

type CompileLogEntry = {
  key: string;
  type: string;
  message: string;
};

/** Helper to consume an SSE response stream and dispatch events via callbacks. */
const consumeSseStream = async (
  res: Response,
  handlers: {
    onProgress?: (event: { type: string; message?: string }) => void;
    onDone?: (data: unknown) => void;
    onError?: (data: { error?: string }) => void;
  },
): Promise<void> => {
  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processChunk = (chunk: string): void => {
    buffer += chunk;
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const lines = part.split("\n");
      const eventLine = lines.find((l) => l.startsWith("event: "));
      const dataLine = lines.find((l) => l.startsWith("data: "));
      if (!eventLine || !dataLine) continue;

      const eventType = eventLine.slice("event: ".length);
      let data: unknown;
      try {
        data = JSON.parse(dataLine.slice("data: ".length));
      } catch {
        continue;
      }

      if (eventType === "progress" && data && typeof data === "object") {
        handlers.onProgress?.(data as { type: string; message?: string });
      } else if (eventType === "done" && data && typeof data === "object") {
        handlers.onDone?.(data);
      } else if (eventType === "error" && data && typeof data === "object") {
        handlers.onError?.(data as { error?: string });
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    processChunk(decoder.decode(value, { stream: true }));
  }
  processChunk(decoder.decode());
};

function RecordPanel({
  onRecordingComplete,
}: {
  onRecordingComplete: (name: string) => void;
}) {
  const [recordName, setRecordName] = useState("");
  const [recordUrl, setRecordUrl] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordLogs, setRecordLogs] = useState<RecordLogEntry[]>([]);
  const [recordResult, setRecordResult] = useState<RecordResultData | null>(null);
  const [recordError, setRecordError] = useState("");
  const [compiling, setCompiling] = useState(false);
  const [compileLogs, setCompileLogs] = useState<CompileLogEntry[]>([]);
  const [compileError, setCompileError] = useState("");
  const [compileComplete, setCompileComplete] = useState(false);

  const startRecording = async (): Promise<void> => {
    if (!recordName.trim() || !recordUrl.trim()) return;
    setRecording(true);
    setRecordLogs([]);
    setRecordResult(null);
    setRecordError("");
    setCompileLogs([]);
    setCompileError("");
    setCompileComplete(false);

    try {
      const res = await fetch("/api/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: recordName.trim(), url: recordUrl.trim() }),
      });

      if (!res.ok) {
        const data = await parseJsonSafe(res);
        setRecordError(asErrorMessage(data, "failed to start recording"));
        setRecording(false);
        return;
      }

      let logIndex = 0;
      await consumeSseStream(res, {
        onProgress: (event) => {
          logIndex++;
          setRecordLogs((prev) => [
            ...prev,
            { key: `rec-${logIndex}`, type: event.type, message: event.message ?? event.type },
          ]);
        },
        onDone: (data) => {
          setRecordResult(data as RecordResultData);
        },
        onError: (data) => {
          setRecordError(data.error ?? "unknown error");
        },
      });
    } catch {
      setRecordError("recording failed");
    } finally {
      setRecording(false);
    }
  };

  const startCompile = async (): Promise<void> => {
    if (!recordResult) return;
    setCompiling(true);
    setCompileLogs([]);
    setCompileError("");
    setCompileComplete(false);

    try {
      const encodedName = encodeURIComponent(recordResult.name);
      const res = await fetch(`/api/compile/${encodedName}`, {
        method: "POST",
      });

      if (!res.ok || !res.body) {
        const data = await parseJsonSafe(res);
        setCompileError(asErrorMessage(data, "compile failed"));
        return;
      }

      let logIndex = 0;
      await consumeSseStream(res, {
        onProgress: (event) => {
          logIndex++;
          setCompileLogs((prev) => [
            ...prev,
            { key: `cmp-${logIndex}`, type: event.type, message: event.message ?? event.type },
          ]);
        },
        onDone: () => {
          setCompileComplete(true);
          onRecordingComplete(recordResult.name);
        },
        onError: (data) => {
          setCompileError(data.error ?? "compile failed");
        },
      });
    } catch {
      setCompileError("compile failed");
    } finally {
      setCompiling(false);
    }
  };

  const resetForm = useCallback((): void => {
    setRecordName("");
    setRecordUrl("");
    setRecordLogs([]);
    setRecordResult(null);
    setRecordError("");
    setCompileLogs([]);
    setCompileError("");
    setCompileComplete(false);
  }, []);

  return (
    <div class="record-panel">
      <h3>New Recording</h3>
      <div class="record-form">
        <input
          type="text"
          placeholder="Recording name"
          value={recordName}
          disabled={recording}
          onInput={(event) => {
            setRecordName((event.target as HTMLInputElement).value);
          }}
        />
        <input
          type="url"
          placeholder="https://example.com"
          value={recordUrl}
          disabled={recording}
          onInput={(event) => {
            setRecordUrl((event.target as HTMLInputElement).value);
          }}
        />
        <button
          type="button"
          class="primary"
          disabled={recording || !recordName.trim() || !recordUrl.trim()}
          onClick={() => void startRecording()}
        >
          {recording ? "Recording..." : "Start Recording"}
        </button>
      </div>
      {recording ? (
        <div class="record-status">
          <div class="record-status-indicator">
            Recording in progress - close the browser to stop
          </div>
        </div>
      ) : null}
      {recordError ? <div class="record-error">{recordError}</div> : null}
      {recordLogs.length > 0 ? (
        <div class="record-log">
          {recordLogs.map((entry) => (
            <div key={entry.key} class="record-log-entry" data-type={entry.type}>
              {entry.message}
            </div>
          ))}
        </div>
      ) : null}
      {recordResult && !compileComplete ? (
        <div class="record-done">
          <div class="record-done-summary">
            Recording complete: {recordResult.eventCount} events captured
          </div>
          <button
            type="button"
            class="primary"
            disabled={compiling}
            onClick={() => void startCompile()}
          >
            {compiling ? "Compiling..." : "Compile to Recipe"}
          </button>
          {compileError ? <div class="record-error">{compileError}</div> : null}
          {compileLogs.length > 0 ? (
            <div class="record-log">
              {compileLogs.map((entry) => (
                <div key={entry.key} class="record-log-entry" data-type={entry.type}>
                  {entry.message}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {compileComplete ? (
        <div class="record-compile-done">
          <div class="record-done-summary">Recipe compiled successfully</div>
          <button type="button" class="secondary" onClick={resetForm}>
            New Recording
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function RecipeEditor() {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [editorText, setEditorText] = useState("");
  const [status, setStatus] = useState("");
  const [currentId, setCurrentId] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [planResult, setPlanResult] = useState<PlanData | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [healEnabled, setHealEnabled] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [runLogs, setRunLogs] = useState<RunLogEntry[]>([]);
  const [runResult, setRunResult] = useState<RunResultData | null>(null);

  const variables = useMemo(() => extractVariables(editorText), [editorText]);

  const handleVarChange = (key: string, value: string): void => {
    setVars((prev) => ({ ...prev, [key]: value }));
  };

  const loadRecipeList = async (): Promise<void> => {
    setRecipes([]);
    try {
      const res = await fetch("/api/recipes");
      const data = await parseJsonSafe(res);
      if (!res.ok) {
        setStatus(asErrorMessage(data, "failed to load recipes"));
        return;
      }
      if (!Array.isArray(data)) {
        setStatus("failed to load recipes");
        return;
      }
      setRecipes(data as RecipeSummary[]);
    } catch {
      setStatus("failed to load recipes");
    }
  };

  const openRecipe = async (id: string): Promise<void> => {
    try {
      const res = await fetch(`/api/recipes/${id}`);
      const data = await parseJsonSafe(res);
      if (!res.ok) {
        setStatus(asErrorMessage(data, "failed to open recipe"));
        return;
      }
      setCurrentId(id);
      setEditorText(JSON.stringify(data, null, 2));
      setStatus(`opened: ${id}`);
      setVars({});
      setPlanResult(null);
      setRunLogs([]);
      setRunResult(null);
    } catch {
      setStatus("failed to open recipe");
    }
  };

  const reloadCurrentRecipe = async (): Promise<void> => {
    if (!currentId) return;
    try {
      const res = await fetch(`/api/recipes/${currentId}`);
      const data = await parseJsonSafe(res);
      if (res.ok && data) {
        setEditorText(JSON.stringify(data, null, 2));
      }
    } catch {
      // best-effort reload
    }
  };

  const saveRecipe = async (): Promise<void> => {
    if (!currentId) return;
    try {
      const payload = JSON.parse(editorText);
      const res = await fetch(`/api/recipes/${currentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setStatus("saved");
        return;
      }
      const data = await parseJsonSafe(res);
      setStatus(asErrorMessage(data, "save failed"));
    } catch {
      setStatus("invalid json");
    }
  };

  const executePlan = async (): Promise<void> => {
    if (!currentId) return;
    setPlanLoading(true);
    setPlanResult(null);
    setStatus("planning...");
    try {
      const validKeys = new Set(variables.map((v) => varKey(v)));
      const filteredVars: Record<string, string> = {};
      for (const [k, v] of Object.entries(vars)) {
        if (v !== "" && validKeys.has(k)) filteredVars[k] = v;
      }
      const body =
        Object.keys(filteredVars).length > 0 ? JSON.stringify({ vars: filteredVars }) : undefined;
      const res = await fetch(`/api/plan/${currentId}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : {},
        body,
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) {
        setStatus(asErrorMessage(data, "plan failed"));
        return;
      }
      setPlanResult(data as PlanData);
      setStatus("plan ready");
    } catch {
      setStatus("plan failed");
    } finally {
      setPlanLoading(false);
    }
  };

  const executeRun = async (): Promise<void> => {
    if (!currentId) return;
    setRunLoading(true);
    setRunLogs([]);
    setRunResult(null);
    const label = healEnabled ? "running (heal)..." : "running...";
    setStatus(label);

    try {
      const validKeys = new Set(variables.map((v) => varKey(v)));
      const filteredVars: Record<string, string> = {};
      for (const [k, v] of Object.entries(vars)) {
        if (v !== "" && validKeys.has(k)) filteredVars[k] = v;
      }

      const payload: Record<string, unknown> = {};
      if (Object.keys(filteredVars).length > 0) payload.vars = filteredVars;
      if (healEnabled) payload.heal = true;

      const hasPayload = Object.keys(payload).length > 0;
      const res = await fetch(`/api/run/${currentId}`, {
        method: "POST",
        headers: hasPayload ? { "Content-Type": "application/json" } : {},
        body: hasPayload ? JSON.stringify(payload) : undefined,
      });

      if (!res.ok || !res.body) {
        setStatus("run failed");
        setRunLoading(false);
        return;
      }

      let logIndex = 0;
      await consumeSseStream(res, {
        onProgress: (event) => {
          const message = event.message ?? event.type;
          logIndex++;
          setRunLogs((prev) => [...prev, { key: `log-${logIndex}`, type: event.type, message }]);
        },
        onDone: (data) => {
          const result = data as RunResultData;
          setRunResult(result);
          setStatus(result.ok ? "run completed" : `run failed: ${result.error ?? "unknown"}`);
          if (result.ok && healEnabled) {
            void reloadCurrentRecipe();
          }
        },
        onError: (data) => {
          const error = data as { error?: string };
          setStatus(`run error: ${error.error ?? "unknown"}`);
        },
      });
    } catch {
      setStatus("run failed");
    } finally {
      setRunLoading(false);
    }
  };

  const handleRecordingComplete = useCallback((name: string) => {
    void loadRecipeList();
    void openRecipe(name);
  }, []);

  useEffect(() => {
    void loadRecipeList();
  }, []);

  return (
    <main>
      <section class="panel">
        <h1>Recipes</h1>
        <ul>
          {recipes.map((recipe) => (
            <li key={recipe.id}>
              <button type="button" onClick={() => void openRecipe(recipe.id)}>
                {recipe.id} v{recipe.version}
              </button>
            </li>
          ))}
        </ul>
        <RecordPanel onRecordingComplete={handleRecordingComplete} />
      </section>
      <section class="panel">
        <div class="row">
          <button id="saveBtn" class="primary" type="button" onClick={() => void saveRecipe()}>
            Save
          </button>
          <button
            id="planBtn"
            class="secondary"
            type="button"
            disabled={!currentId || planLoading}
            onClick={() => void executePlan()}
          >
            {planLoading ? "Planning..." : "Plan"}
          </button>
          <button
            id="runBtn"
            class="primary"
            type="button"
            disabled={!currentId || runLoading}
            onClick={() => void executeRun()}
          >
            {runLoading ? "Running..." : "Run"}
          </button>
          <label class="heal-toggle">
            <input
              type="checkbox"
              checked={healEnabled}
              onChange={(event) => {
                setHealEnabled((event.target as HTMLInputElement).checked);
              }}
            />
            <span>Heal</span>
          </label>
          <span id="status">{status}</span>
        </div>
        <VarsForm variables={variables} vars={vars} onVarsChange={handleVarChange} />
        <textarea
          id="editor"
          placeholder="Select recipe"
          value={editorText}
          onInput={(event) => {
            setEditorText((event.target as HTMLTextAreaElement).value);
          }}
        />
        {planResult ? <PlanResultView plan={planResult} /> : null}
        <RunLogView logs={runLogs} result={runResult} />
      </section>
    </main>
  );
}
