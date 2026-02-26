export type RecordedEventType =
  | "navigation"
  | "click"
  | "input"
  | "keypress"
  | "request"
  | "response"
  | "console";

export type DomAnchors = {
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  nearbyText?: string[];
  css?: string;
  xpath?: string;
  selectorVariants: string[];
};

export type Guard = {
  type: "url_not" | "url_is" | "text_visible";
  value: string;
};

export type Effect = {
  type: "url_changed" | "text_visible" | "min_items";
  value: string;
};

export type RecordedEvent = {
  ts: string;
  type: RecordedEventType;
  url: string;
  intent?: string;
  anchors?: DomAnchors;
  guards?: Guard[];
  effects?: Effect[];
  value?: string;
  key?: string;
  method?: string;
  status?: number;
  requestUrl?: string;
  responseUrl?: string;
  headers?: Record<string, string>;
};

export type StepMode = "http" | "pw";

export type RecipeStep = {
  id: string;
  title: string;
  mode: StepMode;
  action: "goto" | "click" | "fill" | "press" | "fetch" | "extract" | "ensure_login";
  url?: string;
  selectorVariants?: string[];
  value?: string;
  key?: string;
  guards?: Guard[];
  effects?: Effect[];
  fallbackStepIds?: string[];
};

export type FallbackPlan = {
  selectorReSearch: boolean;
  selectorVariants: string[];
  allowRepair: boolean;
};

export type Recipe = {
  schemaVersion: number;
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  source: "compiled" | "repaired";
  steps: RecipeStep[];
  fallback: FallbackPlan;
  notes?: string;
};
