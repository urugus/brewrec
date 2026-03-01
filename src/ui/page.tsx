import type { FC } from "hono/jsx";

const PAGE_STYLE = `
:root {
  --bg: #f7f4ec;
  --panel: #fffdf7;
  --ink: #222;
  --accent: #0f766e;
  --line: #d9d5ca;
}
body {
  margin: 0;
  font-family: "IBM Plex Sans", "Noto Sans JP", sans-serif;
  background: radial-gradient(circle at 20% 10%, #fff4cc, transparent 30%), var(--bg);
  color: var(--ink);
}
main {
  max-width: 1100px;
  margin: 24px auto;
  padding: 0 16px;
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 16px;
}
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px;
}
h1 {
  font-size: 18px;
  margin: 0 0 12px;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
li button {
  width: 100%;
  text-align: left;
  margin-bottom: 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: white;
  padding: 10px;
  cursor: pointer;
}
textarea {
  width: 100%;
  min-height: 500px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}
.row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
button.primary {
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
@media (max-width: 900px) {
  main {
    grid-template-columns: 1fr;
  }
}
`;

export const UI_CLIENT_SCRIPT = `
const recipeList = document.getElementById("recipeList");
const editor = document.getElementById("editor");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");
let currentId = "";

const fetchRecipes = async () => {
  const res = await fetch("/api/recipes");
  const recipes = await res.json();
  recipeList.innerHTML = "";
  for (const recipe of recipes) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.textContent = recipe.id + " v" + recipe.version;
    btn.onclick = () => openRecipe(recipe.id);
    li.appendChild(btn);
    recipeList.appendChild(li);
  }
};

const openRecipe = async (id) => {
  const res = await fetch("/api/recipes/" + id);
  const recipe = await res.json();
  currentId = id;
  editor.value = JSON.stringify(recipe, null, 2);
  status.textContent = "opened: " + id;
};

saveBtn.onclick = async () => {
  if (!currentId) return;
  try {
    const payload = JSON.parse(editor.value);
    const res = await fetch("/api/recipes/" + currentId, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    status.textContent = res.ok ? "saved" : "save failed";
  } catch {
    status.textContent = "invalid json";
  }
};

fetchRecipes();
`;

export const UiLayout: FC = ({ children }) => {
  return (
    <html lang="ja">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>browrec recipes</title>
        <style>{PAGE_STYLE}</style>
      </head>
      <body>
        {children}
        <script type="module" src="/ui-client.js" />
      </body>
    </html>
  );
};

export const RecipeEditorPage: FC = () => {
  return (
    <main>
      <section class="panel">
        <h1>Recipes</h1>
        <ul id="recipeList" />
      </section>
      <section class="panel">
        <div class="row">
          <button id="saveBtn" class="primary" type="button">
            Save
          </button>
          <span id="status" />
        </div>
        <textarea id="editor" placeholder="Select recipe" />
      </section>
    </main>
  );
};
