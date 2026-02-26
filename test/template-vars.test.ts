import { describe, expect, it } from "vitest";
import {
  parseCliVariables,
  resolveRecipeStepTemplates,
  resolveTemplateString,
} from "../src/core/template-vars.js";
import type { RecipeStep } from "../src/types.js";

describe("template vars", () => {
  it("resolves builtin today and now", () => {
    const now = new Date("2026-02-26T12:34:56.000Z");

    expect(resolveTemplateString("{{today}}", { now })).toBe("2026-02-26");
    expect(resolveTemplateString("{{today+2d}}", { now })).toBe("2026-02-28");
    expect(resolveTemplateString("{{today-1d}}", { now })).toBe("2026-02-25");
    expect(resolveTemplateString("{{now}}", { now })).toBe("2026-02-26T12:34:56.000Z");
  });

  it("resolves custom variables", () => {
    expect(
      resolveTemplateString("https://example.com?q={{keyword}}", {
        vars: { keyword: "laptop" },
      }),
    ).toBe("https://example.com?q=laptop");
  });

  it("resolves all mutable fields in recipe step", () => {
    const step: RecipeStep = {
      id: "s1",
      title: "fill date",
      mode: "pw",
      action: "fill",
      selectorVariants: ["input[name='date-{{today}}']"],
      value: "{{today}}",
      guards: [{ type: "url_is", value: "https://example.com/{{tenant}}" }],
      effects: [{ type: "text_visible", value: "done: {{tenant}}" }],
    };

    const resolved = resolveRecipeStepTemplates(step, {
      vars: { tenant: "acme" },
      now: new Date("2026-02-26T01:00:00.000Z"),
    });

    expect(resolved.selectorVariants?.[0]).toBe("input[name='date-2026-02-26']");
    expect(resolved.value).toBe("2026-02-26");
    expect(resolved.guards?.[0]?.value).toBe("https://example.com/acme");
    expect(resolved.effects?.[0]?.value).toBe("done: acme");
  });

  it("parses cli --var pairs", () => {
    expect(parseCliVariables(["tenant=acme", "keyword=notebook"])).toEqual({
      tenant: "acme",
      keyword: "notebook",
    });
  });

  it("fails for unknown template variable", () => {
    expect(() => resolveTemplateString("{{missing}}")).toThrow(/Unknown template variable/);
  });
});
