import { useEffect, useState } from "hono/jsx";

type RecipeSummary = {
  id: string;
  steps: number;
  updatedAt: string;
  version: number;
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

export default function RecipeEditor() {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [editorText, setEditorText] = useState("");
  const [status, setStatus] = useState("");
  const [currentId, setCurrentId] = useState("");

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
          <span id="status">{status}</span>
        </div>
        <textarea
          id="editor"
          placeholder="Select recipe"
          value={editorText}
          onInput={(event) => {
            setEditorText((event.target as HTMLTextAreaElement).value);
          }}
        />
      </section>
    </main>
  );
}
