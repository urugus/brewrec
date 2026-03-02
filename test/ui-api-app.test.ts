import { describe, expect, it } from "vitest";
import { createUiApiApp } from "../src/ui/api-app.js";

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
});
