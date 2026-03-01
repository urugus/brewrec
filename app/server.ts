import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "honox/server";
import { createUiApiApp } from "../src/ui/api-app.js";

const app = createApp();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticRoot = path.resolve(__dirname, ".");

if (import.meta.env.PROD) {
  app.use("/static/*", serveStatic({ root: staticRoot }));
}

app.route("/api", createUiApiApp());

export default app;
