import { describe, expect, it } from "vitest";
import {
  buildRefinePrompt,
  mergeRefinedSteps,
  parseRefineResponse,
} from "../src/core/llm-refine.js";
import type { RecipeStep, RecordedEvent } from "../src/types.js";

const makeStep = (overrides: Partial<RecipeStep> & { id: string }): RecipeStep => ({
  title: "Test",
  mode: "pw",
  action: "goto",
  ...overrides,
});

describe("parseRefineResponse", () => {
  it("parses direct JSON array", () => {
    const result = parseRefineResponse('[{"id":"step-1","title":"テスト"}]');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([{ id: "step-1", title: "テスト" }]);
  });

  it("extracts JSON from markdown code fences", () => {
    const raw = '```json\n[{"id":"step-1","title":"テスト"}]\n```';
    const result = parseRefineResponse(raw);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([{ id: "step-1", title: "テスト" }]);
  });

  it("extracts JSON from bare code fences", () => {
    const raw = '```\n[{"id":"step-1","title":"テスト"}]\n```';
    const result = parseRefineResponse(raw);
    expect(result.isOk()).toBe(true);
  });

  it("returns err for invalid JSON", () => {
    const result = parseRefineResponse("not json at all");
    expect(result.isErr()).toBe(true);
  });

  it("returns err for non-array JSON", () => {
    const result = parseRefineResponse('{"id":"step-1"}');
    expect(result.isErr()).toBe(true);
  });
});

describe("mergeRefinedSteps", () => {
  it("updates title from patch", () => {
    const original = [makeStep({ id: "step-1", title: "Navigate" })];
    const patches = [{ id: "step-1", title: "ログインページへ移動" }];
    const result = mergeRefinedSteps(original, patches);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("ログインページへ移動");
    expect(result[0].mode).toBe("pw");
  });

  it("removes steps not in patches", () => {
    const original = [
      makeStep({ id: "step-1", title: "Navigate" }),
      makeStep({ id: "step-2", title: "Navigate again" }),
      makeStep({ id: "step-3", title: "Click" }),
    ];
    const patches = [
      { id: "step-1", title: "ページへ移動" },
      { id: "step-3", title: "ボタンをクリック" },
    ];
    const result = mergeRefinedSteps(original, patches);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("step-1");
    expect(result[1].id).toBe("step-3");
  });

  it("adds download flag from patch", () => {
    const original = [makeStep({ id: "step-1", title: "Click", action: "click" })];
    const patches = [{ id: "step-1", title: "ダウンロード", download: true }];
    const result = mergeRefinedSteps(original, patches);
    expect(result[0].download).toBe(true);
  });

  it("ignores hallucinated step IDs", () => {
    const original = [makeStep({ id: "step-1", title: "Navigate" })];
    const patches = [
      { id: "step-1", title: "移動" },
      { id: "step-99", title: "架空のステップ" },
    ];
    const result = mergeRefinedSteps(original, patches);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("step-1");
  });

  it("preserves original fields not in patch", () => {
    const original = [
      makeStep({
        id: "step-1",
        title: "Click",
        action: "click",
        selectorVariants: ["button.submit"],
        guards: [{ type: "url_is", value: "https://example.com" }],
      }),
    ];
    const patches = [{ id: "step-1", title: "送信ボタンをクリック" }];
    const result = mergeRefinedSteps(original, patches);
    expect(result[0].selectorVariants).toEqual(["button.submit"]);
    expect(result[0].guards).toEqual([{ type: "url_is", value: "https://example.com" }]);
    expect(result[0].action).toBe("click");
  });

  it("does not set download when patch has download=false", () => {
    const original = [makeStep({ id: "step-1", title: "Click" })];
    const patches = [{ id: "step-1", title: "クリック", download: false }];
    const result = mergeRefinedSteps(original, patches);
    expect(result[0].download).toBeUndefined();
  });
});

describe("buildRefinePrompt", () => {
  it("includes steps JSON and event summary", () => {
    const steps = [makeStep({ id: "step-1", title: "Navigate", url: "https://example.com" })];
    const events: RecordedEvent[] = [
      { ts: "2026-01-01T00:00:00Z", type: "navigation", url: "https://example.com" },
      {
        ts: "2026-01-01T00:00:01Z",
        type: "response",
        url: "https://example.com",
        responseUrl: "https://example.com/file.pdf",
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="test.pdf"',
        },
      },
    ];
    const prompt = buildRefinePrompt(steps, events);
    expect(prompt).toContain('"step-1"');
    expect(prompt).toContain("[nav] https://example.com");
    expect(prompt).toContain("disposition=attachment");
  });
});
