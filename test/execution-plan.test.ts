import { describe, expect, it } from "vitest";
import { buildExecutionPlan } from "../src/core/execution-plan.js";
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
});
