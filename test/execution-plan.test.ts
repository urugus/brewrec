import fs from "node:fs/promises";
import path from "node:path";
import { err } from "neverthrow";
import { describe, expect, it } from "vitest";
import { buildExecutionPlan, buildExecutionPlanResult } from "../src/core/execution-plan.js";
import { vaultPath } from "../src/core/fs.js";
import type { Recipe } from "../src/types.js";

const baseRecipe = (): Recipe => {
  return {
    schemaVersion: 1,
    id: "sample",
    name: "sample",
    version: 1,
    createdAt: "2026-02-26T00:00:00.000Z",
    updatedAt: "2026-02-26T00:00:00.000Z",
    source: "compiled",
    steps: [
      {
        id: "s1",
        title: "goto",
        mode: "pw",
        action: "goto",
        url: "https://example.com/{{tenant}}?d={{targetDate}}&q={{searchKeyword}}",
      },
    ],
    fallback: {
      selectorReSearch: true,
      selectorVariants: [],
      allowRepair: true,
    },
  };
};

describe("execution plan", () => {
  it("resolves cli, builtin, and prompted variables", async () => {
    const recipe: Recipe = {
      ...baseRecipe(),
      variables: [
        { name: "tenant", required: true, resolver: { type: "cli" } },
        { name: "targetDate", type: "date", resolver: { type: "builtin", expr: "today+1d" } },
        {
          name: "searchKeyword",
          resolver: { type: "prompted", promptTemplate: "keyword for {{tenant}}" },
        },
      ],
    };

    const plan = await buildExecutionPlan(recipe, {
      now: new Date("2026-02-26T08:00:00.000Z"),
      cliVars: { tenant: "acme" },
      promptRunner: async (prompt) => {
        expect(prompt).toBe("keyword for acme");
        return "notebook";
      },
    });

    expect(plan.unresolvedVars).toEqual([]);
    expect(plan.resolvedVars).toEqual({
      tenant: "acme",
      targetDate: "2026-02-27",
      searchKeyword: "notebook",
    });
    expect(plan.steps[0]?.url).toBe("https://example.com/acme?d=2026-02-27&q=notebook");
  });

  it("prioritizes cli vars over resolver output", async () => {
    const recipe: Recipe = {
      ...baseRecipe(),
      variables: [
        { name: "tenant", resolver: { type: "builtin", expr: "today" } },
        { name: "targetDate", resolver: { type: "builtin", expr: "today+1d" } },
        { name: "searchKeyword", resolver: { type: "prompted", promptTemplate: "ignored" } },
      ],
    };

    const plan = await buildExecutionPlan(recipe, {
      now: new Date("2026-02-26T08:00:00.000Z"),
      cliVars: { tenant: "tenant-from-cli", searchKeyword: "cli-keyword" },
      promptRunner: async () => "should-not-be-used",
    });

    expect(plan.resolvedVars.tenant).toBe("tenant-from-cli");
    expect(plan.resolvedVars.searchKeyword).toBe("cli-keyword");
    expect(plan.steps[0]?.url).toContain("tenant-from-cli");
    expect(plan.steps[0]?.url).toContain("q=cli-keyword");
  });

  it("reports unresolved variables used in steps", async () => {
    const recipe: Recipe = {
      ...baseRecipe(),
      variables: [{ name: "tenant", required: true, resolver: { type: "cli" } }],
    };

    const plan = await buildExecutionPlan(recipe, {
      now: new Date("2026-02-26T08:00:00.000Z"),
      cliVars: { tenant: "acme" },
      promptRunner: async () => "",
    });

    expect(plan.unresolvedVars).toEqual(["searchKeyword", "targetDate"]);
  });

  it("resolves secret variable from vault", async () => {
    const recipe: Recipe = {
      ...baseRecipe(),
      variables: [
        { name: "tenant", required: true, resolver: { type: "secret" } },
        { name: "targetDate", resolver: { type: "builtin", expr: "today" } },
        { name: "searchKeyword", defaultValue: "default" },
      ],
    };

    const plan = await buildExecutionPlan(recipe, {
      now: new Date("2026-02-26T08:00:00.000Z"),
      promptRunner: async () => "",
      secretLoader: async (_recipeId, varName) => {
        if (varName === "tenant") return "vault-tenant";
        return undefined;
      },
      secretSaver: async () => {},
    });

    expect(plan.resolvedVars.tenant).toBe("vault-tenant");
    expect(plan.unresolvedVars).toEqual([]);
  });

  it("auto-saves cli var to vault for secret-typed variable", async () => {
    const saved: Array<{ recipeId: string; varName: string; value: string }> = [];
    const recipe: Recipe = {
      ...baseRecipe(),
      variables: [
        { name: "tenant", required: true, resolver: { type: "secret" } },
        { name: "targetDate", resolver: { type: "builtin", expr: "today" } },
        { name: "searchKeyword", defaultValue: "default" },
      ],
    };

    await buildExecutionPlan(recipe, {
      now: new Date("2026-02-26T08:00:00.000Z"),
      cliVars: { tenant: "cli-tenant" },
      promptRunner: async () => "",
      secretLoader: async () => undefined,
      secretSaver: async (recipeId, varName, value) => {
        saved.push({ recipeId, varName, value });
      },
    });

    expect(saved).toEqual([{ recipeId: "sample", varName: "tenant", value: "cli-tenant" }]);
  });

  it("reports unresolved when vault has no value and no cli var", async () => {
    const recipe: Recipe = {
      ...baseRecipe(),
      variables: [
        { name: "tenant", required: true, resolver: { type: "secret" } },
        { name: "targetDate", resolver: { type: "builtin", expr: "today" } },
        { name: "searchKeyword", defaultValue: "default" },
      ],
    };

    const plan = await buildExecutionPlan(recipe, {
      now: new Date("2026-02-26T08:00:00.000Z"),
      promptRunner: async () => "",
      secretLoader: async () => undefined,
      secretSaver: async () => {},
    });

    expect(plan.unresolvedVars).toContain("tenant");
  });

  it("resolves auto-generated credential secret variables from vault", async () => {
    const recipe: Recipe = {
      ...baseRecipe(),
      steps: [
        {
          id: "s1",
          title: "Fill email",
          mode: "pw",
          action: "fill",
          selectorVariants: ['input[name="email"]'],
          value: "{{email}}",
          guards: [{ type: "url_is", value: "https://example.com/login" }],
        },
        {
          id: "s2",
          title: "Fill password",
          mode: "pw",
          action: "fill",
          selectorVariants: ['input[type="password"]'],
          value: "{{password}}",
          guards: [{ type: "url_is", value: "https://example.com/login" }],
        },
      ],
      variables: [
        { name: "email", required: true, resolver: { type: "secret" } },
        { name: "password", required: true, resolver: { type: "secret" } },
      ],
    };

    const plan = await buildExecutionPlan(recipe, {
      promptRunner: async () => "",
      secretLoader: async (_recipeId, varName) => {
        if (varName === "email") return "user@example.com";
        if (varName === "password") return "s3cret";
        return undefined;
      },
      secretSaver: async () => {},
    });

    expect(plan.unresolvedVars).toEqual([]);
    expect(plan.steps[0].value).toBe("user@example.com");
    expect(plan.steps[1].value).toBe("s3cret");
  });

  it("validates date variable format", async () => {
    const recipe: Recipe = {
      ...baseRecipe(),
      variables: [
        { name: "targetDate", type: "date", resolver: { type: "prompted", promptTemplate: "x" } },
      ],
    };

    await expect(
      buildExecutionPlan(recipe, {
        promptRunner: async () => "2026/02/27",
      }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("returns typed error result for invalid date variable format", async () => {
    const recipe: Recipe = {
      ...baseRecipe(),
      variables: [
        { name: "targetDate", type: "date", resolver: { type: "prompted", promptTemplate: "x" } },
      ],
    };

    const result = await buildExecutionPlanResult(recipe, {
      promptRunner: async () => "2026/02/27",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("variable_validation_failed");
      expect(result.error.variableName).toBe("targetDate");
      expect(result.error.message).toMatch(/YYYY-MM-DD/);
    }
  });

  it("returns typed error when default secret loader fails", async () => {
    const recipeId = `broken-vault-${Date.now()}`;
    const recipe: Recipe = {
      ...baseRecipe(),
      id: recipeId,
      variables: [{ name: "tenant", required: true, resolver: { type: "secret" } }],
    };

    const file = vaultPath(recipeId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "not valid json", "utf-8");

    try {
      const result = await buildExecutionPlanResult(recipe, {
        promptRunner: async () => "",
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe("secret_store_error");
        if (result.error.kind === "secret_store_error") {
          expect(result.error.phase).toBe("secret_loader");
          expect(result.error.error.kind).toBe("vault_parse_failed");
        }
      }
    } finally {
      await fs.unlink(file).catch(() => {});
    }
  });

  it("returns typed error when secret saver returns typed error result", async () => {
    const recipe: Recipe = {
      ...baseRecipe(),
      variables: [{ name: "tenant", required: true, resolver: { type: "secret" } }],
    };

    const result = await buildExecutionPlanResult(recipe, {
      cliVars: { tenant: "from-cli" },
      promptRunner: async () => "",
      secretLoader: async () => undefined,
      secretSaver: async () =>
        err({
          kind: "vault_write_failed",
          recipeName: "sample",
          message: "disk full",
        }),
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("secret_store_error");
      if (result.error.kind === "secret_store_error") {
        expect(result.error.phase).toBe("secret_saver");
        expect(result.error.error.kind).toBe("vault_write_failed");
      }
    }
  });
});
