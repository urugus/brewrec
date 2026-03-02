import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  formatRecipeStoreError,
  listRecipesResult,
  loadRecipeResult,
  saveRecipeResult,
} from "../core/recipe-store.js";
import { formatRecordStoreError, listRecordingsResult } from "../core/record-store.js";
import { compileServiceResult } from "../services/compile-service.js";
import { planServiceResult } from "../services/plan-service.js";
import { repairServiceResult } from "../services/repair-service.js";
import { runServiceResult } from "../services/run-service.js";
import { isValidRecipe } from "./recipe-validator.js";
import { createSseConnection, sendSseEvent, sseReporter } from "./sse.js";

type ApiErrorPayload = {
  code: string;
  error: string;
};

type ApiErrorStatus = 400 | 404 | 413 | 500;

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (!isObject(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
};

const parseVarsBody = (vars: unknown): string[] => {
  if (!vars) return [];
  if (!isStringRecord(vars)) return [];
  return Object.entries(vars).map(([k, v]) => `${k}=${v}`);
};

const isJsonContentType = (contentType: string | undefined): boolean => {
  if (!contentType) return false;
  return contentType.toLowerCase().includes("application/json");
};

const parseOptionalJsonBody = async (
  c: Context,
  errorPayload: ApiErrorPayload,
): Promise<{ body: unknown } | { errorResponse: Response }> => {
  if (!isJsonContentType(c.req.header("content-type"))) {
    return { body: null };
  }

  const rawBody = await c.req.text();
  if (rawBody.trim() === "") {
    return { body: null };
  }

  try {
    return { body: JSON.parse(rawBody) };
  } catch {
    return { errorResponse: c.json(errorPayload, 400) };
  }
};

const errorResponse = (
  c: Context,
  status: ApiErrorStatus,
  code: string,
  error: string,
): Response => {
  return c.json({ code, error }, status);
};

const sendSseError = (
  sse: ReturnType<typeof createSseConnection>,
  code: string,
  error: string,
): void => {
  sendSseEvent(sse, "error", { code, error });
};

/** @internal */
export const _uiInternals = {
  isValidRecipe,
};

export const createUiApiApp = (): Hono => {
  const app = new Hono();

  app.use(
    "/*",
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: (c) => {
        return errorResponse(c, 413, "payload_too_large", "payload too large");
      },
    }),
  );

  app.get("/recipes", async (c) => {
    const result = await listRecipesResult();
    if (result.isErr()) {
      return errorResponse(c, 500, "recipe_store_error", formatRecipeStoreError(result.error));
    }
    const recipes = result.value;
    return c.json(
      recipes.map((r) => ({
        id: r.id,
        version: r.version,
        updatedAt: r.updatedAt,
        steps: r.steps.length,
      })),
    );
  });

  app.get("/recipes/:id", async (c) => {
    const result = await loadRecipeResult(c.req.param("id"));
    if (result.isErr()) {
      if (result.error.kind === "recipe_read_failed") {
        return errorResponse(c, 404, "recipe_not_found", "recipe not found");
      }
      return errorResponse(c, 500, "recipe_store_error", formatRecipeStoreError(result.error));
    }
    return c.json(result.value);
  });

  app.put("/recipes/:id", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    if (body === undefined) {
      return errorResponse(c, 400, "invalid_json", "invalid json body");
    }
    if (!isObject(body) || typeof body.id !== "string") {
      return errorResponse(c, 400, "invalid_recipe_payload", "invalid recipe payload");
    }
    if (body.id !== c.req.param("id")) {
      return errorResponse(c, 400, "recipe_id_mismatch", "recipe id mismatch");
    }
    if (!isValidRecipe(body)) {
      return errorResponse(c, 400, "invalid_recipe_payload", "invalid recipe payload");
    }

    const saveResult = await saveRecipeResult(body);
    if (saveResult.isErr()) {
      return errorResponse(c, 500, "recipe_store_error", formatRecipeStoreError(saveResult.error));
    }
    return c.json({ ok: true });
  });

  app.get("/health", (c) => {
    return c.json({ ok: true });
  });

  app.get("/recordings", async (c) => {
    const result = await listRecordingsResult();
    if (result.isErr()) {
      return errorResponse(c, 500, "record_store_error", formatRecordStoreError(result.error));
    }
    return c.json(result.value);
  });

  app.post("/compile/:name", (c) => {
    const name = c.req.param("name");
    const sse = createSseConnection();
    const progress = sseReporter(sse);

    void (async () => {
      try {
        const result = await compileServiceResult(name, { progress });
        if (result.isErr()) {
          sendSseError(sse, result.error.code, result.error.message);
        } else {
          sendSseEvent(sse, "done", result.value);
        }
      } catch (cause) {
        sendSseError(sse, "unexpected", String(cause));
      } finally {
        await sse.close();
      }
    })();

    return sse.response;
  });

  app.post("/run/:name", async (c) => {
    const name = c.req.param("name");
    const parsedBody = await parseOptionalJsonBody(c, {
      code: "invalid_json",
      error: "invalid json body",
    });
    if ("errorResponse" in parsedBody) {
      return parsedBody.errorResponse;
    }
    const vars = isObject(parsedBody.body) ? parsedBody.body.vars : undefined;
    const varStrings = parseVarsBody(vars);
    const sse = createSseConnection();
    const progress = sseReporter(sse);

    void (async () => {
      try {
        const result = await runServiceResult(name, { vars: varStrings, progress });
        if (result.isErr()) {
          sendSseError(sse, result.error.code, result.error.message);
        } else {
          sendSseEvent(sse, "done", result.value);
        }
      } catch (cause) {
        sendSseError(sse, "unexpected", String(cause));
      } finally {
        await sse.close();
      }
    })();

    return sse.response;
  });

  app.post("/plan/:name", async (c) => {
    const name = c.req.param("name");
    const parsedBody = await parseOptionalJsonBody(c, {
      code: "invalid_json",
      error: "invalid json body",
    });
    if ("errorResponse" in parsedBody) {
      return parsedBody.errorResponse;
    }
    const vars = isObject(parsedBody.body) ? parsedBody.body.vars : undefined;
    const varStrings = parseVarsBody(vars);

    try {
      const result = await planServiceResult(name, { vars: varStrings });
      if (result.isErr()) {
        const clientErrors = new Set(["invalid_vars", "unresolved_vars"]);
        let status: 400 | 404 | 500;
        if (result.error.code === "recipe_not_found") {
          status = 404;
        } else if (clientErrors.has(result.error.code)) {
          status = 400;
        } else {
          status = 500;
        }
        return errorResponse(c, status, result.error.code, result.error.message);
      }
      return c.json(result.value);
    } catch (cause) {
      return errorResponse(c, 500, "unexpected", String(cause));
    }
  });

  app.post("/repair/:name", async (c) => {
    const name = c.req.param("name");
    const result = await repairServiceResult(name);
    if (result.isErr()) {
      const status = result.error.code === "recipe_not_found" ? 404 : 500;
      return errorResponse(c, status, result.error.code, result.error.message);
    }
    return c.json(result.value);
  });

  return app;
};
