import { describe, expect, it } from "vitest";
import { createUiApiApp } from "../src/ui/api-app.js";

const parseSseEventPayload = (
  body: string,
  eventName: string,
): Record<string, unknown> | undefined => {
  const chunks = body.split("\n\n");
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const event = lines.find((line) => line.startsWith("event: "));
    const data = lines.find((line) => line.startsWith("data: "));
    if (!event || !data) continue;
    if (event !== `event: ${eventName}`) continue;
    return JSON.parse(data.slice("data: ".length)) as Record<string, unknown>;
  }
  return undefined;
};

describe("ui api app", () => {
  it("returns healthy response", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("returns 400 for invalid json body on run endpoint", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/run/sample", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{invalid",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_json",
      error: "invalid json body",
    });
  });

  it("returns 400 for invalid json body on plan endpoint", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/plan/sample", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{invalid",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_json",
      error: "invalid json body",
    });
  });

  it("returns unified error payload for missing recipe", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/recipes/no-such-recipe");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "recipe_not_found",
      error: "recipe not found",
    });
  });

  it("returns unified error payload for invalid recipe update json", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/recipes/sample", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: "{invalid",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_json",
      error: "invalid json body",
    });
  });

  it("emits unified error payload in compile SSE stream", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/compile/__missing_recording_for_sse__", {
      method: "POST",
    });
    const body = await response.text();
    const payload = parseSseEventPayload(body, "error");

    expect(response.status).toBe(200);
    expect(payload).toBeDefined();
    expect(payload?.code).toBe("recording_read_failed");
    expect(typeof payload?.error).toBe("string");
    expect(payload).not.toHaveProperty("message");
  });

  it("emits unified error payload in run SSE stream", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/run/__missing_recipe_for_sse__", {
      method: "POST",
    });
    const body = await response.text();
    const payload = parseSseEventPayload(body, "error");

    expect(response.status).toBe(200);
    expect(payload).toBeDefined();
    expect(payload?.code).toBe("recipe_not_found");
    expect(typeof payload?.error).toBe("string");
    expect(payload).not.toHaveProperty("message");
  });

  it("emits unified error payload in debug SSE stream", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/debug/__missing_recipe_for_sse__", {
      method: "POST",
    });
    const body = await response.text();
    const payload = parseSseEventPayload(body, "error");

    expect(response.status).toBe(200);
    expect(payload).toBeDefined();
    expect(payload?.code).toBe("recipe_not_found");
    expect(typeof payload?.error).toBe("string");
    expect(payload).not.toHaveProperty("message");
  });

  it("returns 400 for invalid json body on debug endpoint", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/debug/sample", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{invalid",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_json",
      error: "invalid json body",
    });
  });

  it("returns 400 for invalid json body on record endpoint", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/record", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{invalid",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_json",
      error: "invalid json body",
    });
  });

  it("returns 400 when record name is missing", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/record", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_payload",
      error: "name is required",
    });
  });

  it("returns 400 when record url is missing", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/record", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "test-recording" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_payload",
      error: "url is required",
    });
  });

  it("returns 400 when record name contains path traversal", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/record", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "../evil", url: "https://example.com" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_payload",
      error: "name contains invalid characters",
    });
  });

  it("returns 400 when record body is empty", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/record", {
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_payload",
      error: "request body required",
    });
  });

  it("returns 404 for missing artifact file", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/artifacts/nonexistent.webm");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "not_found",
      error: "file not found",
    });
  });

  it("returns 400 for artifact path traversal", async () => {
    const app = createUiApiApp();

    const response = await app.request("http://localhost/artifacts/..%2Fsecret.txt");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_path",
      error: "invalid filename",
    });
  });
});
