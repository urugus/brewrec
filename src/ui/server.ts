import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import open from "open";
import { PROJECT_ROOT } from "../core/paths.js";
import { _uiInternals } from "./api-app.js";

type FetchApp = {
  fetch: (request: Request, env?: unknown, executionCtx?: unknown) => Response | Promise<Response>;
};

const DIST_UI_ENTRY = path.join(PROJECT_ROOT, "dist-ui", "index.js");

const loadBuiltUiApp = async (): Promise<FetchApp> => {
  try {
    await fs.access(DIST_UI_ENTRY);
  } catch {
    throw new Error(
      `UI bundle not found at ${DIST_UI_ENTRY}. Run "npm run build:ui" (or "npm run build") first.`,
    );
  }

  const moduleUrl = `${pathToFileURL(DIST_UI_ENTRY).href}?t=${Date.now()}`;
  const loaded = (await import(moduleUrl)) as { default?: unknown };
  const app = loaded.default as FetchApp | undefined;
  if (!app || typeof app.fetch !== "function") {
    throw new Error(`Invalid UI bundle: ${DIST_UI_ENTRY} does not export a fetch app as default.`);
  }
  return app;
};

export const startUiServer = async (port = 4312): Promise<void> => {
  const app = await loadBuiltUiApp();
  serve({ fetch: app.fetch, port }, (info) => {
    const url = `http://localhost:${info.port}`;
    process.stdout.write(`UI: ${url}\n`);
    void open(url);
  });
};

/** @internal */
export { _uiInternals };
