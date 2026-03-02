import { useEffect, useMemo, useState } from "hono/jsx";

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

export default function RecipeEditor() {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [editorText, setEditorText] = useState("");
  const [status, setStatus] = useState("");
  const [currentId, setCurrentId] = useState("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [planResult, setPlanResult] = useState<PlanData | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

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
    } catch {
      setStatus("failed to open recipe");
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
      </section>
    </main>
  );
}
