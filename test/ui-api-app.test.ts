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
      error: "invalid json body",
      code: "invalid_json",
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
      error: "invalid json body",
      code: "invalid_json",
    });
  });
});
