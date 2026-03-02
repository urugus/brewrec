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

type StatusType = "info" | "success" | "error" | "loading";

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

const MODE_LABELS: Record<string, string> = {
  pw: "browser",
  http: "http",
};

const MODE_TITLES: Record<string, string> = {
  pw: "Browser automation via Playwright",
  http: "Direct HTTP request",
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
                  {v.required ? (
                    <span class="var-required" title="This variable is required">
                      {" "}
                      *
                    </span>
                  ) : (
                    <span class="var-optional">(optional)</span>
                  )}
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
              <span
                class="step-badge"
                data-mode={step.mode}
                title={MODE_TITLES[step.mode] ?? step.mode}
              >
                {MODE_LABELS[step.mode] ?? step.mode}
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

type DebugLogEntry = {
  key: string;
  type: string;
  message: string;
};

type DebugResultData = {
  name: string;
  version: number;
  ok: boolean;
  stepsTotal: number;
  stepsCompleted: number;
  videoFilename?: string;
  error?: string;
};

function DebugLogView({ logs, result }: { logs: DebugLogEntry[]; result: DebugResultData | null }) {
  if (logs.length === 0 && !result) return null;

  const videoFilename = result?.videoFilename ?? null;

  return (
    <div class={`debug-log ${result ? (result.ok ? "debug-log-ok" : "debug-log-fail") : ""}`}>
      <h3>Debug Log</h3>
      {result ? (
        <div class="debug-result-summary">
          {result.ok ? "Completed" : "Failed"}
          {" - "}
          {result.name} v{result.version} ({result.stepsCompleted}/{result.stepsTotal} steps)
          {result.error ? `: ${result.error}` : ""}
        </div>
      ) : null}
      {result && videoFilename ? (
        <div class="debug-video-link">
          <a
            href={`/api/artifacts/${encodeURIComponent(videoFilename)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View recorded video
          </a>
        </div>
      ) : null}
      <div class="debug-log-entries">
        {logs.map((entry) => (
          <div key={entry.key} class="debug-log-entry" data-type={entry.type}>
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
          aria-label="Recording name"
          value={recordName}
          disabled={recording}
          onInput={(event) => {
            setRecordName((event.target as HTMLInputElement).value);
          }}
        />
        <input
          type="url"
          placeholder="https://example.com"
          aria-label="Start URL for recording"
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
            <span class="record-dot" /> Recording in progress
          </div>
          <p class="record-status-help">
            Interact with the browser that opened. When done, close it to finish recording.
          </p>
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
  const [statusText, setStatusText] = useState("");
  const [statusType, setStatusType] = useState<StatusType>("info");
  const [currentId, setCurrentId] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [planResult, setPlanResult] = useState<PlanData | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [healEnabled, setHealEnabled] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [runLogs, setRunLogs] = useState<RunLogEntry[]>([]);
  const [runResult, setRunResult] = useState<RunResultData | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [debugResult, setDebugResult] = useState<DebugResultData | null>(null);

  const variables = useMemo(() => extractVariables(editorText), [editorText]);

  const setStatus = (text: string, type: StatusType = "info"): void => {
    setStatusText(text);
    setStatusType(type);
  };

  const handleVarChange = (key: string, value: string): void => {
    setVars((prev) => ({ ...prev, [key]: value }));
  };

  const loadRecipeList = async (): Promise<void> => {
    try {
      const res = await fetch("/api/recipes");
      const data = await parseJsonSafe(res);
      if (!res.ok) {
        setStatus(asErrorMessage(data, "failed to load recipes"), "error");
        return;
      }
      if (!Array.isArray(data)) {
        setStatus("failed to load recipes", "error");
        return;
      }
      setRecipes(data as RecipeSummary[]);
    } catch {
      setStatus("failed to load recipes", "error");
    }
  };

  const openRecipe = async (id: string): Promise<void> => {
    try {
      const res = await fetch(`/api/recipes/${id}`);
      const data = await parseJsonSafe(res);
      if (!res.ok) {
        setStatus(asErrorMessage(data, "failed to open recipe"), "error");
        return;
      }
      setCurrentId(id);
      setEditorText(JSON.stringify(data, null, 2));
      setStatus(`opened: ${id}`, "info");
      setVars({});
      setPlanResult(null);
      setRunLogs([]);
      setRunResult(null);
      setDebugLogs([]);
      setDebugResult(null);
    } catch {
      setStatus("failed to open recipe", "error");
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
        setStatus("saved", "success");
        return;
      }
      const data = await parseJsonSafe(res);
      setStatus(asErrorMessage(data, "save failed"), "error");
    } catch {
      setStatus("invalid json — fix syntax errors and try again", "error");
    }
  };

  const executePlan = async (): Promise<void> => {
    if (!currentId) return;
    setPlanLoading(true);
    setPlanResult(null);
    setStatus("planning...", "loading");
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
        setStatus(asErrorMessage(data, "plan failed"), "error");
        return;
      }
      setPlanResult(data as PlanData);
      setStatus("plan ready", "success");
    } catch {
      setStatus("plan failed", "error");
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
    setStatus(label, "loading");

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
        setStatus("run failed", "error");
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
          setStatus(
            result.ok ? "run completed" : `run failed: ${result.error ?? "unknown"}`,
            result.ok ? "success" : "error",
          );
          if (result.ok && healEnabled) {
            void reloadCurrentRecipe();
          }
        },
        onError: (data) => {
          const error = data as { error?: string };
          setStatus(`run error: ${error.error ?? "unknown"}`, "error");
        },
      });
    } catch {
      setStatus("run failed", "error");
    } finally {
      setRunLoading(false);
    }
  };

  const executeDebug = async (): Promise<void> => {
    if (!currentId) return;
    setDebugLoading(true);
    setDebugLogs([]);
    setDebugResult(null);
    setStatus("debugging...", "loading");

    try {
      const validKeys = new Set(variables.map((v) => varKey(v)));
      const filteredVars: Record<string, string> = {};
      for (const [k, v] of Object.entries(vars)) {
        if (v !== "" && validKeys.has(k)) filteredVars[k] = v;
      }

      const payload: Record<string, unknown> = {};
      if (Object.keys(filteredVars).length > 0) payload.vars = filteredVars;

      const hasPayload = Object.keys(payload).length > 0;
      const res = await fetch(`/api/debug/${currentId}`, {
        method: "POST",
        headers: hasPayload ? { "Content-Type": "application/json" } : {},
        body: hasPayload ? JSON.stringify(payload) : undefined,
      });

      if (!res.ok || !res.body) {
        setStatus("debug failed", "error");
        setDebugLoading(false);
        return;
      }

      let logIndex = 0;
      await consumeSseStream(res, {
        onProgress: (event) => {
          const message = event.message ?? event.type;
          logIndex++;
          setDebugLogs((prev) => [...prev, { key: `dbg-${logIndex}`, type: event.type, message }]);
        },
        onDone: (data) => {
          const result = data as DebugResultData;
          setDebugResult(result);
          setStatus(
            result.ok ? "debug completed" : `debug failed: ${result.error ?? "unknown"}`,
            result.ok ? "success" : "error",
          );
        },
        onError: (data) => {
          const error = data as { error?: string };
          setStatus(`debug error: ${error.error ?? "unknown"}`, "error");
        },
      });
    } catch {
      setStatus("debug failed", "error");
    } finally {
      setDebugLoading(false);
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
        {recipes.length === 0 ? (
          <div class="empty-state">
            <p class="empty-state-desc">
              No recipes yet. Create your first recipe by recording a browser session below.
            </p>
          </div>
        ) : (
          <ul aria-label="Recipe list">
            {recipes.map((recipe) => (
              <li key={recipe.id}>
                <button
                  type="button"
                  class={currentId === recipe.id ? "recipe-item-active" : ""}
                  aria-label={`Open recipe ${recipe.id} version ${recipe.version}`}
                  onClick={() => void openRecipe(recipe.id)}
                >
                  <span class="recipe-item-name">{recipe.id}</span>
                  <span class="recipe-item-meta">
                    v{recipe.version} &middot; {recipe.steps} steps
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <RecordPanel onRecordingComplete={handleRecordingComplete} />
      </section>
      <section class="panel editor-panel">
        <h2 class="editor-title">{currentId || "Recipe Editor"}</h2>
        <div class="row">
          <button
            id="saveBtn"
            class="primary"
            type="button"
            title="Save changes to the recipe JSON"
            disabled={!currentId}
            onClick={() => void saveRecipe()}
          >
            Save
          </button>
          <span class="row-divider" />
          <button
            id="planBtn"
            class="secondary"
            type="button"
            title="Preview the execution plan and resolved variables"
            disabled={!currentId || planLoading}
            onClick={() => void executePlan()}
          >
            {planLoading ? "Planning..." : "Plan"}
          </button>
          <button
            id="runBtn"
            class="primary"
            type="button"
            title="Execute the recipe in headless browser mode"
            disabled={!currentId || runLoading}
            onClick={() => void executeRun()}
          >
            {runLoading ? "Running..." : "Run"}
          </button>
          <button
            id="debugBtn"
            class="secondary"
            type="button"
            title="Execute step-by-step with video recording"
            disabled={!currentId || debugLoading}
            onClick={() => void executeDebug()}
          >
            {debugLoading ? "Debugging..." : "Debug"}
          </button>
          <label
            class="heal-toggle"
            title="Auto-fix broken selectors during run. Updates the recipe after successful execution."
          >
            <input
              type="checkbox"
              checked={healEnabled}
              onChange={(event) => {
                setHealEnabled((event.target as HTMLInputElement).checked);
              }}
            />
            <span>Auto-heal</span>
          </label>
          <output id="status" class={`status-text status-${statusType}`}>
            {statusType === "loading" ? <span class="status-spinner" /> : null}
            {statusText}
          </output>
        </div>
        <VarsForm variables={variables} vars={vars} onVarsChange={handleVarChange} />
        {currentId ? (
          <textarea
            id="editor"
            aria-label="Recipe JSON editor"
            placeholder="Select recipe"
            value={editorText}
            onInput={(event) => {
              setEditorText((event.target as HTMLTextAreaElement).value);
            }}
          />
        ) : (
          <div class="editor-empty-state">
            <p class="editor-empty-title">Select a recipe to get started</p>
            <p class="editor-empty-desc">
              Choose a recipe from the left panel, or record a new browser session.
            </p>
            <div class="workflow-steps">
              <span class="workflow-step">Record</span>
              <span class="workflow-arrow">&rarr;</span>
              <span class="workflow-step">Compile</span>
              <span class="workflow-arrow">&rarr;</span>
              <span class="workflow-step">Plan</span>
              <span class="workflow-arrow">&rarr;</span>
              <span class="workflow-step">Run</span>
            </div>
          </div>
        )}
        {planResult ? <PlanResultView plan={planResult} /> : null}
        <RunLogView logs={runLogs} result={runResult} />
        <DebugLogView logs={debugLogs} result={debugResult} />
      </section>
    </main>
  );
}
