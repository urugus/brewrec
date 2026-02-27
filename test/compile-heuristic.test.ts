import { describe, expect, it } from "vitest";
import {
  aggregateInputEvents,
  deduplicateClicks,
  eventsToCompileResult,
  eventsToSteps,
  isApiCandidate,
  isDocumentDownload,
  isMonitoringRequest,
  isStaticAsset,
} from "../src/core/compile-heuristic.js";
import type { RecordedEvent } from "../src/types.js";

describe("isStaticAsset", () => {
  it("detects CSS/JS/font/image files", () => {
    expect(isStaticAsset("https://example.com/style.css")).toBe(true);
    expect(isStaticAsset("https://example.com/app.js")).toBe(true);
    expect(isStaticAsset("https://example.com/font.woff2")).toBe(true);
    expect(isStaticAsset("https://example.com/logo.png")).toBe(true);
    expect(isStaticAsset("https://example.com/icon.svg")).toBe(true);
    expect(isStaticAsset("https://example.com/style.css?ver=1.0")).toBe(true);
  });

  it("detects CDN/font hosts", () => {
    expect(isStaticAsset("https://fonts.googleapis.com/css2?family=Roboto")).toBe(true);
    expect(isStaticAsset("https://fonts.gstatic.com/s/roboto/v30/font.woff2")).toBe(true);
    expect(isStaticAsset("https://cdn.jsdelivr.net/npm/lib@1/dist/lib.min.js")).toBe(true);
  });

  it("does not flag API/document URLs", () => {
    expect(isStaticAsset("https://example.com/api/search?q=foo")).toBe(false);
    expect(isStaticAsset("https://example.com/report.pdf")).toBe(false);
  });
});

describe("isDocumentDownload", () => {
  it("detects PDF/office/archive files", () => {
    expect(isDocumentDownload("https://example.com/report.pdf")).toBe(true);
    expect(isDocumentDownload("https://example.com/data.xlsx")).toBe(true);
    expect(isDocumentDownload("https://example.com/archive.zip")).toBe(true);
    expect(isDocumentDownload("https://example.com/file.csv?dl=1")).toBe(true);
  });

  it("does not flag non-document URLs", () => {
    expect(isDocumentDownload("https://example.com/api/data")).toBe(false);
    expect(isDocumentDownload("https://example.com/style.css")).toBe(false);
  });
});

describe("isApiCandidate", () => {
  it("promotes API-like request with JSON response", () => {
    const requestEvent: RecordedEvent = {
      ts: "2026-02-26T00:00:02.000Z",
      type: "request",
      url: "https://example.com/search",
      requestUrl: "https://example.com/api/search?q=foo",
      method: "GET",
      headers: { accept: "application/json" },
    };

    expect(
      isApiCandidate(requestEvent, {
        status: 200,
        contentType: "application/json",
      }),
    ).toBe(true);
  });

  it("skips HTML page request", () => {
    const requestEvent: RecordedEvent = {
      ts: "2026-02-26T00:00:02.000Z",
      type: "request",
      url: "https://example.com/search",
      requestUrl: "https://example.com/search?q=foo",
      method: "GET",
      headers: { accept: "text/html" },
    };

    expect(
      isApiCandidate(requestEvent, {
        status: 200,
        contentType: "text/html",
      }),
    ).toBe(false);
  });
});

describe("eventsToSteps", () => {
  it("converts navigation/input/request into mixed-mode steps", () => {
    const events: RecordedEvent[] = [
      {
        ts: "2026-02-26T00:00:00.000Z",
        type: "navigation",
        url: "https://example.com",
      },
      {
        ts: "2026-02-26T00:00:01.000Z",
        type: "input",
        url: "https://example.com",
        value: "foo",
        anchors: {
          selectorVariants: ["input[name=q]"],
        },
      },
      {
        ts: "2026-02-26T00:00:02.000Z",
        type: "response",
        url: "https://example.com",
        responseUrl: "https://example.com/api/search?q=foo",
        headers: { "content-type": "application/json" },
        status: 200,
      },
      {
        ts: "2026-02-26T00:00:02.000Z",
        type: "request",
        url: "https://example.com",
        requestUrl: "https://example.com/api/search?q=foo",
        method: "GET",
        headers: { accept: "application/json" },
      },
    ];

    const steps = eventsToSteps(events);

    expect(steps).toHaveLength(3);
    expect(steps[0]?.action).toBe("goto");
    expect(steps[1]?.action).toBe("fill");
    expect(steps[2]?.mode).toBe("http");
  });

  it("filters static assets, keeps documents, and deduplicates requests", () => {
    const events: RecordedEvent[] = [
      {
        ts: "2026-02-26T00:00:00.000Z",
        type: "navigation",
        url: "https://example.com",
      },
      {
        ts: "2026-02-26T00:00:01.000Z",
        type: "request",
        url: "https://example.com",
        requestUrl: "https://example.com/style.css",
      },
      {
        ts: "2026-02-26T00:00:01.000Z",
        type: "request",
        url: "https://example.com",
        requestUrl: "https://example.com/report.pdf",
      },
      {
        ts: "2026-02-26T00:00:02.000Z",
        type: "response",
        url: "https://example.com",
        responseUrl: "https://example.com/api/data",
        headers: { "content-type": "application/json" },
        status: 200,
      },
      {
        ts: "2026-02-26T00:00:03.000Z",
        type: "request",
        url: "https://example.com",
        requestUrl: "https://example.com/api/data",
        method: "GET",
        headers: { accept: "application/json" },
      },
      {
        ts: "2026-02-26T00:00:04.000Z",
        type: "request",
        url: "https://example.com",
        requestUrl: "https://example.com/api/data",
        method: "GET",
        headers: { accept: "application/json" },
      },
    ];

    const { steps, stats } = eventsToCompileResult(events);

    expect(steps).toHaveLength(3);
    expect(steps[0]?.action).toBe("goto");
    expect(steps[1]?.title).toBe("Download document");
    expect(steps[2]?.title).toBe("Fetch API");
    expect(stats.httpPromoted).toBe(2);
  });
});

describe("aggregateInputEvents", () => {
  it("collapses consecutive input events on same element into one", () => {
    const events: RecordedEvent[] = [
      {
        ts: "2026-02-27T00:00:00.000Z",
        type: "input",
        url: "https://example.com",
        value: "a",
        anchors: { selectorVariants: ['input[name="email"]'] },
      },
      {
        ts: "2026-02-27T00:00:00.100Z",
        type: "input",
        url: "https://example.com",
        value: "ab",
        anchors: { selectorVariants: ['input[name="email"]'] },
      },
      {
        ts: "2026-02-27T00:00:00.200Z",
        type: "input",
        url: "https://example.com",
        value: "abc",
        anchors: { selectorVariants: ['input[name="email"]'] },
      },
    ];

    const result = aggregateInputEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("abc");
  });

  it("preserves secret metadata on aggregated event", () => {
    const events: RecordedEvent[] = [
      {
        ts: "2026-02-27T00:00:00.000Z",
        type: "input",
        url: "https://example.com",
        value: "***",
        secret: true,
        secretFieldName: "password",
        anchors: { selectorVariants: ['input[type="password"]'] },
      },
      {
        ts: "2026-02-27T00:00:00.100Z",
        type: "input",
        url: "https://example.com",
        value: "***",
        secret: true,
        secretFieldName: "password",
        anchors: { selectorVariants: ['input[type="password"]'] },
      },
    ];

    const result = aggregateInputEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].secret).toBe(true);
    expect(result[0].secretFieldName).toBe("password");
  });

  it("skips keypress events between consecutive inputs", () => {
    const events: RecordedEvent[] = [
      {
        ts: "2026-02-27T00:00:00.000Z",
        type: "input",
        url: "https://example.com",
        value: "a",
        anchors: { selectorVariants: ['input[name="email"]'] },
      },
      { ts: "2026-02-27T00:00:00.050Z", type: "keypress", url: "https://example.com", key: "b" },
      {
        ts: "2026-02-27T00:00:00.100Z",
        type: "input",
        url: "https://example.com",
        value: "ab",
        anchors: { selectorVariants: ['input[name="email"]'] },
      },
      { ts: "2026-02-27T00:00:00.150Z", type: "keypress", url: "https://example.com", key: "c" },
      {
        ts: "2026-02-27T00:00:00.200Z",
        type: "input",
        url: "https://example.com",
        value: "abc",
        anchors: { selectorVariants: ['input[name="email"]'] },
      },
    ];

    const result = aggregateInputEvents(events);
    const inputs = result.filter((e) => e.type === "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].value).toBe("abc");
  });

  it("breaks aggregation on Tab/Enter keypress (focus-changing keys)", () => {
    const events: RecordedEvent[] = [
      {
        ts: "2026-02-27T00:00:00.000Z",
        type: "input",
        url: "https://example.com",
        value: "a",
        anchors: { selectorVariants: ['input[name="email"]'] },
      },
      { ts: "2026-02-27T00:00:00.050Z", type: "keypress", url: "https://example.com", key: "Tab" },
      {
        ts: "2026-02-27T00:00:00.100Z",
        type: "input",
        url: "https://example.com",
        value: "b",
        anchors: { selectorVariants: ['input[name="email"]'] },
      },
    ];

    const result = aggregateInputEvents(events);
    const inputs = result.filter((e) => e.type === "input");
    expect(inputs).toHaveLength(2);
    expect(inputs[0].value).toBe("a");
    expect(inputs[1].value).toBe("b");
  });

  it("does not merge inputs separated by other events", () => {
    const events: RecordedEvent[] = [
      {
        ts: "2026-02-27T00:00:00.000Z",
        type: "input",
        url: "https://example.com",
        value: "a",
        anchors: { selectorVariants: ['input[name="email"]'] },
      },
      {
        ts: "2026-02-27T00:00:01.000Z",
        type: "click",
        url: "https://example.com",
        anchors: { selectorVariants: ["button"] },
      },
      {
        ts: "2026-02-27T00:00:02.000Z",
        type: "input",
        url: "https://example.com",
        value: "b",
        anchors: { selectorVariants: ['input[name="email"]'] },
      },
    ];

    const result = aggregateInputEvents(events);
    expect(result).toHaveLength(3);
  });
});

describe("deduplicateClicks", () => {
  it("collapses consecutive clicks on same element into one", () => {
    const events: RecordedEvent[] = [
      {
        ts: "2026-02-27T00:00:00.000Z",
        type: "click",
        url: "https://example.com",
        anchors: { selectorVariants: ["i.fa.fa-download"] },
      },
      {
        ts: "2026-02-27T00:00:00.100Z",
        type: "click",
        url: "https://example.com",
        anchors: { selectorVariants: ["i.fa.fa-download"] },
      },
      {
        ts: "2026-02-27T00:00:00.200Z",
        type: "click",
        url: "https://example.com",
        anchors: { selectorVariants: ["i.fa.fa-download"] },
      },
    ];

    const result = deduplicateClicks(events);
    expect(result).toHaveLength(1);
  });
});

describe("isMonitoringRequest", () => {
  it("detects DataDog RUM", () => {
    expect(
      isMonitoringRequest("https://rum.browser-intake-datadoghq.com/api/v2/rum?ddsource=browser"),
    ).toBe(true);
  });

  it("detects Google Analytics", () => {
    expect(isMonitoringRequest("https://www.google-analytics.com/collect")).toBe(true);
  });

  it("detects mpc2-prod measurement endpoint", () => {
    expect(isMonitoringRequest("https://mpc2-prod-24-is5qnl632q-uw.a.run.app/events?cee=no")).toBe(
      true,
    );
  });

  it("does not flag normal API URLs", () => {
    expect(isMonitoringRequest("https://ssl.wf.jobcan.jp/api/v1/login_user/")).toBe(false);
  });
});
