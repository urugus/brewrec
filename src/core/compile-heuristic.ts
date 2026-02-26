import type { RecipeStep, RecordedEvent } from "../types.js";

const STATIC_ASSET_RE =
  /\.(?:css|js|woff2?|ttf|eot|otf|png|jpe?g|gif|svg|ico|webp|avif|mp4|webm)(?:\?|$)/i;

const STATIC_HOST_RE =
  /^https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//;

export function isStaticAsset(url: string): boolean {
  return STATIC_ASSET_RE.test(url) || STATIC_HOST_RE.test(url);
}

export function isDocumentDownload(url: string): boolean {
  return /\.(?:pdf|docx?|xlsx?|csv|zip|tar\.gz)(?:\?|$)/i.test(url);
}

export function eventToStep(
  event: RecordedEvent,
  index: number,
  navigationUrls: Set<string>,
): RecipeStep | null {
  const id = `step-${index + 1}`;

  if (event.type === "navigation") {
    return {
      id,
      title: "Navigate",
      mode: "pw",
      action: "goto",
      url: event.url,
      effects: event.effects,
    };
  }

  if (event.type === "click" && event.anchors) {
    return {
      id,
      title: event.intent ?? "Click target",
      mode: "pw",
      action: "click",
      selectorVariants: event.anchors.selectorVariants,
      guards: event.guards,
      effects: event.effects,
    };
  }

  if (event.type === "input" && event.anchors) {
    return {
      id,
      title: event.intent ?? "Fill input",
      mode: "pw",
      action: "fill",
      selectorVariants: event.anchors.selectorVariants,
      value: event.value,
      guards: event.guards,
      effects: event.effects,
    };
  }

  if (event.type === "request" && event.requestUrl?.startsWith("http")) {
    const reqUrl = event.requestUrl;

    // ナビゲーションと同じURLは goto で処理済みなのでスキップ
    if (navigationUrls.has(reqUrl)) return null;

    // ドキュメントDLは fetch ステップとして残す
    if (isDocumentDownload(reqUrl)) {
      return {
        id,
        title: "Download document",
        mode: "http",
        action: "fetch",
        url: reqUrl,
      };
    }

    // 静的アセットはスキップ
    if (isStaticAsset(reqUrl)) return null;

    return {
      id,
      title: "Fetch API",
      mode: "http",
      action: "fetch",
      url: reqUrl,
    };
  }

  return null;
}

export function eventsToSteps(events: RecordedEvent[]): RecipeStep[] {
  const navigationUrls = new Set(
    events.filter((e) => e.type === "navigation").map((e) => e.url),
  );

  return events
    .map((event, index) => eventToStep(event, index, navigationUrls))
    .filter((step): step is RecipeStep => step !== null);
}
