import fs from "node:fs/promises";
import type { RecordedEvent } from "../types.js";
import { ensureBaseDirs, recordingDir, recordingRawPath, recordingSnapshotsDir } from "./fs.js";

export async function initRecording(name: string): Promise<void> {
  await ensureBaseDirs();
  await fs.mkdir(recordingDir(name), { recursive: true });
  await fs.mkdir(recordingSnapshotsDir(name), { recursive: true });
  await fs.writeFile(recordingRawPath(name), "", "utf-8");
}

export async function appendRecordedEvent(name: string, event: RecordedEvent): Promise<void> {
  const line = `${JSON.stringify(event)}\n`;
  await fs.appendFile(recordingRawPath(name), line, "utf-8");
}

export async function readRecordedEvents(name: string): Promise<RecordedEvent[]> {
  const raw = await fs.readFile(recordingRawPath(name), "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RecordedEvent);
}
