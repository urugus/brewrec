import { describe, expect, it } from "vitest";
import { _runInternals } from "../src/commands/run.js";
import type { RecipeStep } from "../src/types.js";

describe("run command internals", () => {
  it("replaces only failed step and keeps tail steps", () => {
    const steps: RecipeStep[] = [
      { id: "s1", title: "a", mode: "pw", action: "click", selectorVariants: ["#a"] },
      { id: "s2", title: "b", mode: "pw", action: "click", selectorVariants: ["#b"] },
      { id: "s3", title: "c", mode: "pw", action: "click", selectorVariants: ["#c"] },
    ];

    const replaced = _runInternals.applyPhase2Replacements(steps, [
      {
        replacedFromStepId: "s2",
        newSteps: [
          {
            id: "s2-healed-1",
            title: "b1",
            mode: "pw",
            action: "click",
            selectorVariants: ["#b1"],
          },
          {
            id: "s2-healed-2",
            title: "b2",
            mode: "http",
            action: "fetch",
            url: "https://example.com/api",
          },
        ],
      },
    ]);

    expect(replaced.map((s) => s.id)).toEqual(["s1", "s2-healed-1", "s2-healed-2", "s3"]);
  });

  it("parses RFC 5987 filename* from content-disposition", () => {
    const filename = _runInternals.parseContentDispositionFilename(
      "attachment; filename*=UTF-8''report%20Q1.pdf",
    );
    expect(filename).toBe("report Q1.pdf");
  });

  it("matches wildcard URL patterns", () => {
    expect(
      _runInternals.matchesUrl("https://example.com/path*", "https://example.com/path?a=1"),
    ).toBe(true);
    expect(_runInternals.matchesUrl("https://example.com/path", "https://example.com/other")).toBe(
      false,
    );
  });
});
