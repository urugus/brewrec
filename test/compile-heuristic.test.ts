import { describe, expect, it } from "vitest";
import {
  eventsToCompileResult,
  eventsToSteps,
  isApiCandidate,
  isDocumentDownload,
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
