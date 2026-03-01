import fs from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { recordingDir, recordingRawPath } from "../src/core/fs.js";
import {
  appendRecordedEventResult,
  formatRecordStoreError,
  initRecordingResult,
  readRecordedEvents,
  readRecordedEventsResult,
} from "../src/core/record-store.js";
import type { RecordedEvent } from "../src/types.js";

const createdDirs = new Set<string>();

const uniqueName = (prefix: string): string => {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const sampleEvent = (): RecordedEvent => ({
  ts: "2026-03-01T00:00:00.000Z",
  type: "navigation",
  url: "https://example.com",
});

afterEach(async () => {
  for (const dirPath of createdDirs) {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch {
      // noop
    }
  }
  createdDirs.clear();
});

describe("record-store result APIs", () => {
  it("initializes, appends, and reads events via Result API", async () => {
    const name = uniqueName("record-store-ok");
    createdDirs.add(recordingDir(name));

    const initResult = await initRecordingResult(name);
    expect(initResult.isOk()).toBe(true);

    const appendResult = await appendRecordedEventResult(name, sampleEvent());
    expect(appendResult.isOk()).toBe(true);

    const readResult = await readRecordedEventsResult(name);
    expect(readResult.isOk()).toBe(true);
    if (readResult.isOk()) {
      expect(readResult.value).toHaveLength(1);
      expect(readResult.value[0].type).toBe("navigation");
    }
  });

  it("returns typed read error for missing recording file", async () => {
    const result = await readRecordedEventsResult(uniqueName("record-store-missing"));
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("recording_read_failed");
      expect(formatRecordStoreError(result.error)).toContain("Recording read failed");
    }
  });

  it("returns parse error with line number for malformed JSONL", async () => {
    const name = uniqueName("record-store-parse");
    createdDirs.add(recordingDir(name));
    await initRecordingResult(name);

    const rawPath = recordingRawPath(name);
    await fs.writeFile(rawPath, `${JSON.stringify(sampleEvent())}\nnot-json\n`, "utf-8");

    const result = await readRecordedEventsResult(name);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("recording_parse_failed");
      if (result.error.kind === "recording_parse_failed") {
        expect(result.error.line).toBe(2);
      }
    }
  });

  it("compatibility API throws formatted error", async () => {
    await expect(readRecordedEvents(uniqueName("record-store-compat-missing"))).rejects.toThrow(
      /Recording read failed/,
    );
  });
});
