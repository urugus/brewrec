import build from "@hono/vite-build";
import nodeAdapter from "@hono/vite-dev-server/node";
import honox from "honox/vite";
import { defineConfig } from "vite";

const UI_OUT_DIR = "dist-ui";

const createHonoxPlugin = () =>
  honox({
    devServer: { adapter: nodeAdapter },
    client: { input: ["/app/client.ts"] },
    entry: "./app/server.ts",
  });

export default defineConfig(({ mode }) => {
  if (mode === "client") {
    return {
      define: {
        "process.env": "process.env",
      },
      plugins: [createHonoxPlugin()],
      build: {
        outDir: UI_OUT_DIR,
        emptyOutDir: true,
        rollupOptions: {
          output: {
            entryFileNames: "static/client.js",
            chunkFileNames: "static/assets/[name]-[hash].js",
            assetFileNames: "static/assets/[name][extname]",
          },
        },
      },
    };
  }

  return {
    define: {
      "process.env": "process.env",
    },
    plugins: [
      createHonoxPlugin(),
      build({
        entry: "./app/server.ts",
        output: "index.js",
        outputDir: `./${UI_OUT_DIR}`,
        emptyOutDir: false,
        external: ["playwright"],
      }),
    ],
    build: {
      outDir: UI_OUT_DIR,
      emptyOutDir: false,
    },
  };
});
