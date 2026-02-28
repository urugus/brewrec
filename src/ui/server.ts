import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import open from "open";
import { PUBLIC_DIR } from "../core/paths.js";
import { listRecipes, loadRecipe, saveRecipe } from "../core/recipe-store.js";
import type { Recipe } from "../types.js";

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
};

const isValidRecipe = (value: unknown): value is Recipe => {
  if (!isObject(value)) return false;
  if (typeof value.schemaVersion !== "number") return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.version !== "number") return false;
  if (typeof value.createdAt !== "string") return false;
  if (typeof value.updatedAt !== "string") return false;
  if (!["compiled", "repaired", "healed"].includes(String(value.source))) return false;

  if (!Array.isArray(value.steps)) return false;
  const validActions = new Set([
    "goto",
    "click",
    "fill",
    "press",
    "fetch",
    "extract",
    "ensure_login",
  ]);
  for (const step of value.steps) {
    if (!isObject(step)) return false;
    if (typeof step.id !== "string") return false;
    if (typeof step.title !== "string") return false;
    if (!["http", "pw"].includes(String(step.mode))) return false;
    if (!validActions.has(String(step.action))) return false;
    if (step.url !== undefined && typeof step.url !== "string") return false;
    if (step.method !== undefined && typeof step.method !== "string") return false;
    if (step.body !== undefined && typeof step.body !== "string") return false;
    if (step.download !== undefined && typeof step.download !== "boolean") return false;
    if (step.value !== undefined && typeof step.value !== "string") return false;
    if (step.key !== undefined && typeof step.key !== "string") return false;
    if (step.selectorVariants !== undefined && !isStringArray(step.selectorVariants)) return false;
    if (step.fallbackStepIds !== undefined && !isStringArray(step.fallbackStepIds)) return false;
    if (step.headers !== undefined) {
      if (!isObject(step.headers)) return false;
      if (Object.values(step.headers).some((headerValue) => typeof headerValue !== "string"))
        return false;
    }

    if (step.guards !== undefined) {
      if (!Array.isArray(step.guards)) return false;
      for (const guard of step.guards) {
        if (!isObject(guard)) return false;
        if (!["url_not", "url_is", "text_visible"].includes(String(guard.type))) return false;
        if (typeof guard.value !== "string") return false;
      }
    }

    if (step.effects !== undefined) {
      if (!Array.isArray(step.effects)) return false;
      for (const effect of step.effects) {
        if (!isObject(effect)) return false;
        if (!["url_changed", "text_visible", "min_items"].includes(String(effect.type)))
          return false;
        if (typeof effect.value !== "string") return false;
      }
    }

    const action = String(step.action);
    const mode = String(step.mode);
    if (mode === "http" && ["goto", "click", "fill", "press"].includes(action)) return false;

    if (action === "click" || action === "fill") {
      const selectorVariants = step.selectorVariants;
      if (!isStringArray(selectorVariants) || selectorVariants.length === 0) return false;
    }

    if (action === "fill") {
      const valueField = step.value;
      if (typeof valueField !== "string" || valueField.length === 0) return false;
    }

    if (action === "press") {
      const key = step.key;
      if (typeof key !== "string" || key.length === 0) return false;
    }

    if (action === "goto" || action === "fetch") {
      const url = step.url;
      if (typeof url !== "string" || url.length === 0) return false;
    }
  }

  if (!isObject(value.fallback)) return false;
  if (typeof value.fallback.selectorReSearch !== "boolean") return false;
  if (!isStringArray(value.fallback.selectorVariants)) return false;
  if (typeof value.fallback.allowRepair !== "boolean") return false;

  if (value.downloadDir !== undefined && typeof value.downloadDir !== "string") return false;
  if (value.notes !== undefined && typeof value.notes !== "string") return false;

  if (value.variables !== undefined) {
    if (!Array.isArray(value.variables)) return false;
    for (const variable of value.variables) {
      if (!isObject(variable)) return false;
      if (typeof variable.name !== "string") return false;
      if (variable.description !== undefined && typeof variable.description !== "string")
        return false;
      if (variable.required !== undefined && typeof variable.required !== "boolean") return false;
      if (variable.defaultValue !== undefined && typeof variable.defaultValue !== "string")
        return false;
      if (variable.pattern !== undefined && typeof variable.pattern !== "string") return false;
      if (variable.type !== undefined && variable.type !== "string" && variable.type !== "date") {
        return false;
      }
      if (variable.resolver !== undefined) {
        if (!isObject(variable.resolver)) return false;
        if (
          variable.resolver.type !== "cli" &&
          variable.resolver.type !== "builtin" &&
          variable.resolver.type !== "prompted" &&
          variable.resolver.type !== "secret"
        ) {
          return false;
        }
      }
    }
  }

  return true;
};

/** @internal */
export const _uiInternals = {
  isValidRecipe,
};

export const startUiServer = async (port = 4312): Promise<void> => {
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
      const body = req.body;
      if (!isObject(body) || typeof body.id !== "string") {
        res.status(400).json({ error: "invalid recipe payload" });
        return;
      }
      if (body.id !== req.params.id) {
        res.status(400).json({ error: "recipe id mismatch" });
        return;
      }
      if (!isValidRecipe(body)) {
        res.status(400).json({ error: "invalid recipe payload" });
        return;
      }

      await saveRecipe(body);
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
};
