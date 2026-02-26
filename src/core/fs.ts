import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACTS_DIR, RECIPES_DIR, RECORDINGS_DIR } from "./paths.js";

export async function ensureBaseDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(RECORDINGS_DIR, { recursive: true }),
    fs.mkdir(RECIPES_DIR, { recursive: true }),
    fs.mkdir(ARTIFACTS_DIR, { recursive: true }),
  ]);
}

export function recordingDir(name: string): string {
  return path.join(RECORDINGS_DIR, name);
}

export function recordingRawPath(name: string): string {
  return path.join(recordingDir(name), "raw.jsonl");
}

export function recordingSnapshotsDir(name: string): string {
  return path.join(recordingDir(name), "snapshots");
}

export function recipePath(name: string): string {
  return path.join(RECIPES_DIR, `${name}.recipe.json`);
}

export function artifactDir(name: string): string {
  return path.join(ARTIFACTS_DIR, name);
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
