import type { APIRequestContext, BrowserContext } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { _runInternals } from "../src/commands/run.js";
import { matchesUrl } from "../src/core/step-validation.js";
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
    expect(matchesUrl("https://example.com/path*", "https://example.com/path?a=1")).toBe(true);
    expect(matchesUrl("https://example.com/path", "https://example.com/other")).toBe(false);
  });

  it("supports wildcard url_is guards when checking HTTP guard heal fallback", () => {
    const step: RecipeStep = {
      id: "s-http",
      title: "fetch",
      mode: "http",
      action: "fetch",
      url: "https://example.com/api",
      guards: [{ type: "url_is", value: "https://example.com/path*" }],
    };

    expect(_runInternals.canSkipGuardForHttp(step, "https://example.com/another")).toBe(true);
    expect(_runInternals.canSkipGuardForHttp(step, "https://other.example.com/another")).toBe(
      false,
    );
  });

  it("syncs HTTP cookies back to browser context", async () => {
    const addCookies = vi.fn(async () => {});
    const pwContext = { addCookies } as unknown as BrowserContext;
    const httpContext = {
      storageState: async () => ({
        cookies: [
          {
            name: "sid",
            value: "abc",
            domain: "example.com",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: "Lax" as const,
          },
        ],
        origins: [],
      }),
    } as unknown as APIRequestContext;

    await _runInternals.syncHttpCookiesToBrowserContext(pwContext, httpContext);
    expect(addCookies).toHaveBeenCalledTimes(1);
  });
});
