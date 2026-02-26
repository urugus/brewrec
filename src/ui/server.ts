import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import open from "open";
import { PUBLIC_DIR } from "../core/paths.js";
import { listRecipes, loadRecipe, saveRecipe } from "../core/recipe-store.js";

export async function startUiServer(port = 4312): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(express.static(PUBLIC_DIR));

  app.get("/api/recipes", async (_req, res) => {
    const recipes = await listRecipes();
    res.json(
      recipes.map((r) => ({
        id: r.id,
        version: r.version,
        updatedAt: r.updatedAt,
        steps: r.steps.length,
      })),
    );
  });

  app.get("/api/recipes/:id", async (req, res) => {
    try {
      const recipe = await loadRecipe(req.params.id);
      res.json(recipe);
    } catch {
      res.status(404).json({ error: "recipe not found" });
    }
  });

  app.put("/api/recipes/:id", async (req, res) => {
    try {
      await saveRecipe(req.body);
      res.json({ ok: true });
    } catch {
      res.status(400).json({ error: "invalid recipe payload" });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("*", async (_req, res) => {
    const html = await fs.readFile(path.join(PUBLIC_DIR, "index.html"), "utf-8");
    res.type("html").send(html);
  });

  app.listen(port, async () => {
    const url = `http://localhost:${port}`;
    process.stdout.write(`UI: ${url}\n`);
    await open(url);
  });
}
