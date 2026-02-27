import { describe, expect, it } from "vitest";
import { applyCredentialVariables } from "../src/core/credential-vars.js";
import type { RecipeStep, RecordedEvent } from "../src/types.js";

const makeSecretEvent = (selector: string, fieldName: string): RecordedEvent => ({
  ts: "2026-02-27T00:00:00.000Z",
  type: "input",
  url: "https://example.com/login",
  value: "***",
  secret: true,
  secretFieldName: fieldName,
  anchors: { selectorVariants: [selector] },
});

const makeFillStep = (id: string, selector: string, value: string): RecipeStep => ({
  id,
  title: "Fill input",
  mode: "pw",
  action: "fill",
  selectorVariants: [selector],
  value,
  guards: [{ type: "url_is", value: "https://example.com/login" }],
});

describe("applyCredentialVariables", () => {
  it("converts masked fill step to template variable", () => {
    const events: RecordedEvent[] = [makeSecretEvent('input[type="password"]', "password")];
    const steps: RecipeStep[] = [makeFillStep("s1", 'input[type="password"]', "***")];

    const result = applyCredentialVariables(steps, events);

    expect(result.steps[0].value).toBe("{{password}}");
    expect(result.variables).toEqual([
      { name: "password", required: true, resolver: { type: "secret" } },
    ]);
  });

  it("handles multiple credential fields", () => {
    const events: RecordedEvent[] = [
      makeSecretEvent('input[name="email"]', "email"),
      makeSecretEvent('input[type="password"]', "password"),
    ];
    const steps: RecipeStep[] = [
      makeFillStep("s1", 'input[name="email"]', "***"),
      makeFillStep("s2", 'input[type="password"]', "***"),
    ];

    const result = applyCredentialVariables(steps, events);

    expect(result.steps[0].value).toBe("{{email}}");
    expect(result.steps[1].value).toBe("{{password}}");
    expect(result.variables).toHaveLength(2);
    expect(result.variables.map((v) => v.name)).toEqual(["email", "password"]);
  });

  it("does not modify non-secret fill steps", () => {
    const events: RecordedEvent[] = [
      {
        ts: "2026-02-27T00:00:00.000Z",
        type: "input",
        url: "https://example.com/search",
        value: "search term",
        anchors: { selectorVariants: ['input[name="q"]'] },
      },
    ];
    const steps: RecipeStep[] = [makeFillStep("s1", 'input[name="q"]', "search term")];

    const result = applyCredentialVariables(steps, events);

    expect(result.steps[0].value).toBe("search term");
    expect(result.variables).toEqual([]);
  });

  it("deduplicates variables with same inferred name", () => {
    const selector = 'input[type="password"]';
    const events: RecordedEvent[] = [
      makeSecretEvent(selector, "password"),
      makeSecretEvent(selector, "password"),
    ];
    const steps: RecipeStep[] = [
      makeFillStep("s1", selector, "***"),
      makeFillStep("s2", selector, "***"),
    ];

    const result = applyCredentialVariables(steps, events);

    expect(result.variables).toHaveLength(1);
    expect(result.steps[0].value).toBe("{{password}}");
    expect(result.steps[1].value).toBe("{{password}}");
  });

  it("ignores fill steps without matching secret event", () => {
    const events: RecordedEvent[] = [];
    const steps: RecipeStep[] = [makeFillStep("s1", 'input[type="password"]', "***")];

    const result = applyCredentialVariables(steps, events);

    expect(result.steps[0].value).toBe("***");
    expect(result.variables).toEqual([]);
  });
});
