import fs from "node:fs/promises";
import { type Result, err, ok } from "neverthrow";
import type { RecordedEvent } from "../types.js";
import { ensureBaseDirs, recordingDir, recordingRawPath, recordingSnapshotsDir } from "./fs.js";
import { RECORDINGS_DIR } from "./paths.js";

export type RecordStoreError =
  | {
      kind: "recording_init_failed";
      recordingName: string;
      message: string;
    }
  | {
      kind: "recording_append_failed";
      recordingName: string;
      message: string;
    }
  | {
      kind: "recording_read_failed";
      recordingName: string;
      message: string;
    }
  | {
      kind: "recording_parse_failed";
      recordingName: string;
      line: number;
      message: string;
    };

const causeMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  return String(cause);
};

export const formatRecordStoreError = (error: RecordStoreError): string => {
  if (error.kind === "recording_init_failed") {
    return `Recording init failed (${error.recordingName}): ${error.message}`;
  }
  if (error.kind === "recording_append_failed") {
    return `Recording append failed (${error.recordingName}): ${error.message}`;
  }
  if (error.kind === "recording_read_failed") {
    return `Recording read failed (${error.recordingName}): ${error.message}`;
  }
  return `Recording parse failed (${error.recordingName} line=${error.line}): ${error.message}`;
};

export const initRecordingResult = async (
  name: string,
): Promise<Result<void, RecordStoreError>> => {
  try {
    await ensureBaseDirs();
    await fs.mkdir(recordingDir(name), { recursive: true });
    await fs.mkdir(recordingSnapshotsDir(name), { recursive: true });
    await fs.writeFile(recordingRawPath(name), "", "utf-8");
    return ok(undefined);
  } catch (cause) {
    return err({
      kind: "recording_init_failed",
      recordingName: name,
      message: causeMessage(cause),
    });
  }
};

export const appendRecordedEventResult = async (
  name: string,
  event: RecordedEvent,
): Promise<Result<void, RecordStoreError>> => {
  const line = `${JSON.stringify(event)}\n`;
  try {
    await fs.appendFile(recordingRawPath(name), line, "utf-8");
    return ok(undefined);
  } catch (cause) {
    return err({
      kind: "recording_append_failed",
      recordingName: name,
      message: causeMessage(cause),
    });
  }
};

export const readRecordedEventsResult = async (
  name: string,
): Promise<Result<RecordedEvent[], RecordStoreError>> => {
  let raw = "";
  try {
    raw = await fs.readFile(recordingRawPath(name), "utf-8");
  } catch (cause) {
    return err({
      kind: "recording_read_failed",
      recordingName: name,
      message: causeMessage(cause),
    });
  }

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const events: RecordedEvent[] = [];

  for (const [index, line] of lines.entries()) {
    try {
      events.push(JSON.parse(line) as RecordedEvent);
    } catch (cause) {
      return err({
        kind: "recording_parse_failed",
        recordingName: name,
        line: index + 1,
        message: causeMessage(cause),
      });
    }
  }

  return ok(events);
};

export const listRecordingsResult = async (): Promise<Result<string[], RecordStoreError>> => {
  try {
    await ensureBaseDirs();
    const entries = await fs.readdir(RECORDINGS_DIR, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        await fs.access(recordingRawPath(entry.name));
        names.push(entry.name);
      } catch {
        // not a valid recording directory
      }
    }
    names.sort();
    return ok(names);
  } catch (cause) {
    return err({
      kind: "recording_read_failed",
      recordingName: "*",
      message: causeMessage(cause),
    });
  }
};

export const initRecording = async (name: string): Promise<void> => {
  const result = await initRecordingResult(name);
  if (result.isErr()) {
    throw new Error(formatRecordStoreError(result.error));
  }
};

export const appendRecordedEvent = async (name: string, event: RecordedEvent): Promise<void> => {
  const result = await appendRecordedEventResult(name, event);
  if (result.isErr()) {
    throw new Error(formatRecordStoreError(result.error));
  }
};

export const readRecordedEvents = async (name: string): Promise<RecordedEvent[]> => {
  const result = await readRecordedEventsResult(name);
  if (result.isErr()) {
    throw new Error(formatRecordStoreError(result.error));
  }
  return result.value;
};
