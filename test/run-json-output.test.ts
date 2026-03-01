import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadRecipeResult = vi.fn();
const mockSaveRecipeResult = vi.fn();
const mockResolveDownloadDir = vi.fn();
const mockRequestNewContext = vi.fn();

vi.mock("../src/core/recipe-store.js", () => ({
  loadRecipeResult: (...args: unknown[]) => mockLoadRecipeResult(...args),
  saveRecipeResult: (...args: unknown[]) => mockSaveRecipeResult(...args),
  formatRecipeStoreError: (error: { kind: string }) => `recipe:${error.kind}`,
}));

vi.mock("../src/core/fs.js", () => ({
  resolveDownloadDir: (...args: unknown[]) => mockResolveDownloadDir(...args),
}));

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(async () => {
      throw new Error("chromium should not launch for http-only test");
    }),
  },
  request: {
    newContext: (...args: unknown[]) => mockRequestNewContext(...args),
  },
}));

import { runCommandResult } from "../src/commands/run.js";
import type { Recipe } from "../src/types.js";

const baseRecipe = (): Recipe => ({
  schemaVersion: 1,
  id: "sample",
  name: "sample",
  version: 7,
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  source: "compiled",
  steps: [
    {
      id: "s1",
      title: "fetch api",
      mode: "http",
      action: "fetch",
      url: "https://example.com/api",
    },
  ],
  fallback: {
    selectorReSearch: true,
    selectorVariants: [],
    allowRepair: true,
  },
});

describe("run --json output contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadRecipeResult.mockResolvedValue(ok(baseRecipe()));
    mockSaveRecipeResult.mockResolvedValue(ok(undefined));
    mockResolveDownloadDir.mockResolvedValue("/tmp");
    mockRequestNewContext.mockResolvedValue({
      fetch: vi.fn(async () => {
        throw new Error("network down");
      }),
      dispose: vi.fn(async () => {}),
      storageState: vi.fn(async () => ({ cookies: [], origins: [] })),
    });
  });

  it("emits execute-phase JSON failure payload when execution fails", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const result = await runCommandResult("sample", {
      json: true,
      vars: [],
      planOnly: false,
      heal: false,
    });

    expect(result.isErr()).toBe(true);
    expect(writeSpy).toHaveBeenCalled();

    const lines = writeSpy.mock.calls
      .map(([payload]) => String(payload))
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const last = lines[lines.length - 1];
    expect(last).toBeDefined();
    const parsed = JSON.parse(last ?? "{}");
    expect(parsed).toMatchObject({
      name: "sample",
      version: 7,
      ok: false,
      phase: "execute",
    });
    expect(parsed.error).toContain("Step s1 failed: network down");
  });
});
