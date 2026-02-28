import type { RecipeStep, RecordedEvent } from "../types.js";

const STATIC_ASSET_RE =
  /\.(?:css|js|woff2?|ttf|eot|otf|png|jpe?g|gif|svg|ico|webp|avif|mp4|webm)(?:\?|$)/i;

const STATIC_HOST_RE =
  /^https?:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//;

const MONITORING_HOSTS = [
  "rum.browser-intake-datadoghq.com",
  "google-analytics.com",
  "doubleclick.net",
  "hotjar.com",
  "mixpanel.com",
  "sentry.io",
];

type ResponseInfo = {
  status?: number;
  contentType?: string;
};

const DEFAULT_HTTP_METHOD = "GET";

export type CompileStats = {
  httpPromoted: number;
  httpSkipped: number;
};

export type CompileResult = {
  steps: RecipeStep[];
  stats: CompileStats;
};

export const isStaticAsset = (url: string): boolean => {
  return STATIC_ASSET_RE.test(url) || STATIC_HOST_RE.test(url);
};

export const isDocumentDownload = (url: string): boolean => {
  return /\.(?:pdf|docx?|xlsx?|csv|zip|tar\.gz)(?:\?|$)/i.test(url);
};

const buildResponseMap = (events: RecordedEvent[]): Map<string, ResponseInfo> => {
  const map = new Map<string, ResponseInfo>();
  for (const event of events) {
    if (event.type !== "response" || !event.responseUrl) continue;
    map.set(event.responseUrl, {
      status: event.status,
      contentType: event.headers?.["content-type"],
    });
  }
  return map;
};

const getPath = (url: string): string => {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
};

const getHost = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export const isMonitoringRequest = (url: string): boolean => {
  const host = getHost(url);
  if (!host) return false;
  if (host.startsWith("mpc2-prod-")) return true;
  return MONITORING_HOSTS.some((m) => host === m || host.endsWith(`.${m}`));
};

export const isApiCandidate = (requestEvent: RecordedEvent, response?: ResponseInfo): boolean => {
  if (!requestEvent.requestUrl) return false;
  const reqUrl = requestEvent.requestUrl;

  if (isStaticAsset(reqUrl) || isDocumentDownload(reqUrl) || isMonitoringRequest(reqUrl))
    return false;

  const path = getPath(reqUrl);
  const method = (requestEvent.method ?? "GET").toUpperCase();
  const accept = requestEvent.headers?.accept ?? "";
  const contentType = (response?.contentType ?? "").toLowerCase();

  let score = 0;

  if (path.includes("/api/") || path.startsWith("/api")) score += 2;
  if (/^https?:\/\/api\./i.test(reqUrl)) score += 2;
  if (method !== "GET") score += 1;
  if (accept.includes("application/json")) score += 1;

  if (
    contentType.includes("application/json") ||
    contentType.includes("application/xml") ||
    contentType.includes("text/csv")
  ) {
    score += 2;
  }

  if (contentType.includes("text/html")) score -= 2;
  if (path.includes("analytics") || path.includes("tracking") || path.includes("pixel")) score -= 2;

  if (response?.status && response.status >= 400) return false;

  return score >= 2;
};

const normalizeHttpMethod = (method?: string): string => {
  const normalized = method?.trim().toUpperCase();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_HTTP_METHOD;
};

const pickReplayHeaders = (
  headers?: Record<string, string>,
): Record<string, string> | undefined => {
  if (!headers) return undefined;
  const picked: Record<string, string> = {};
  const contentType = headers["content-type"] ?? headers["Content-Type"];
  const accept = headers.accept ?? headers.Accept;
  if (contentType) picked["content-type"] = contentType;
  if (accept) picked.accept = accept;
  return Object.keys(picked).length > 0 ? picked : undefined;
};

const requestEventToFetchStep = (
  id: string,
  title: string,
  event: RecordedEvent,
  options?: { guards?: RecipeStep["guards"]; download?: boolean },
): RecipeStep => {
  const method = normalizeHttpMethod(event.method);
  const body = method === "GET" || method === "HEAD" ? undefined : event.postData;
  return {
    id,
    title,
    mode: "http",
    action: "fetch",
    url: event.requestUrl,
    method,
    headers: pickReplayHeaders(event.headers),
    body,
    guards: options?.guards,
    download: options?.download,
  };
};

const eventToStep = (
  event: RecordedEvent,
  index: number,
  navigationUrls: Set<string>,
  responseMap: Map<string, ResponseInfo>,
  seenRequestUrls: Set<string>,
): RecipeStep | null => {
  const id = `step-${index + 1}`;

  if (event.type === "navigation") {
    return {
      id,
      title: "Navigate",
      mode: "pw",
      action: "goto",
      url: event.url,
      effects: [{ type: "url_changed", value: event.url }],
    };
  }

  if (event.type === "click" && event.anchors) {
    return {
      id,
      title: event.intent ?? "Click target",
      mode: "pw",
      action: "click",
      selectorVariants: event.anchors.selectorVariants,
      guards: [{ type: "url_is", value: event.url }],
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
      guards: [{ type: "url_is", value: event.url }],
      effects: event.effects,
    };
  }

  if (event.type === "request" && event.requestUrl?.startsWith("http")) {
    const reqUrl = event.requestUrl;

    if (navigationUrls.has(reqUrl)) return null;
    if (seenRequestUrls.has(reqUrl)) return null;

    if (isDocumentDownload(reqUrl)) {
      seenRequestUrls.add(reqUrl);
      return requestEventToFetchStep(id, "Download document", event, { download: true });
    }

    const response = responseMap.get(reqUrl);
    if (!isApiCandidate(event, response)) return null;

    seenRequestUrls.add(reqUrl);
    return requestEventToFetchStep(id, "Fetch API", event, {
      guards: [{ type: "url_is", value: event.url }],
    });
  }

  return null;
};

const selectorKey = (event: RecordedEvent): string | undefined => {
  return event.anchors?.selectorVariants[0];
};

const FOCUS_CHANGING_KEYS = new Set(["Tab", "Enter", "Escape"]);

const isTransparentEvent = (event: RecordedEvent): boolean => {
  if (event.type === "console") return true;
  if (event.type === "keypress") {
    return !FOCUS_CHANGING_KEYS.has(event.key ?? "");
  }
  return false;
};

export const aggregateInputEvents = (events: RecordedEvent[]): RecordedEvent[] => {
  const result: RecordedEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.type !== "input" || !event.anchors) {
      result.push(event);
      continue;
    }
    const key = selectorKey(event);
    let last = event;
    let j = i + 1;
    while (j < events.length) {
      if (isTransparentEvent(events[j])) {
        j++;
        continue;
      }
      if (events[j].type === "input" && selectorKey(events[j]) === key) {
        last = events[j];
        j++;
        continue;
      }
      break;
    }
    result.push(last);
    i = j - 1;
  }
  return result;
};

export const deduplicateClicks = (events: RecordedEvent[]): RecordedEvent[] => {
  const result: RecordedEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.type !== "click" || !event.anchors) {
      result.push(event);
      continue;
    }
    result.push(event);
    const key = selectorKey(event);
    while (
      i + 1 < events.length &&
      events[i + 1].type === "click" &&
      selectorKey(events[i + 1]) === key
    ) {
      i++;
    }
  }
  return result;
};

export const eventsToCompileResult = (events: RecordedEvent[]): CompileResult => {
  const preprocessed = deduplicateClicks(aggregateInputEvents(events));
  const navigationUrls = new Set(
    preprocessed.filter((e) => e.type === "navigation").map((e) => e.url),
  );
  const responseMap = buildResponseMap(preprocessed);
  const seenRequestUrls = new Set<string>();

  const steps = preprocessed
    .map((event, index) => eventToStep(event, index, navigationUrls, responseMap, seenRequestUrls))
    .filter((step): step is RecipeStep => step !== null);

  const httpPromoted = steps.filter((step) => step.mode === "http").length;
  const allRequestCount = events.filter((event) => event.type === "request").length;

  return {
    steps,
    stats: {
      httpPromoted,
      httpSkipped: Math.max(allRequestCount - httpPromoted, 0),
    },
  };
};

export const eventsToSteps = (events: RecordedEvent[]): RecipeStep[] => {
  return eventsToCompileResult(events).steps;
};
