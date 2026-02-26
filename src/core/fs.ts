import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACTS_DIR, RECIPES_DIR, RECORDINGS_DIR } from "./paths.js";

export const ensureBaseDirs = async (): Promise<void> => {
  await Promise.all([
    fs.mkdir(RECORDINGS_DIR, { recursive: true }),
    fs.mkdir(RECIPES_DIR, { recursive: true }),
    fs.mkdir(ARTIFACTS_DIR, { recursive: true }),
  ]);
};

export const recordingDir = (name: string): string => {
  return path.join(RECORDINGS_DIR, name);
};

export const recordingRawPath = (name: string): string => {
  return path.join(recordingDir(name), "raw.jsonl");
};

export const recordingSnapshotsDir = (name: string): string => {
  return path.join(recordingDir(name), "snapshots");
};

export const recipePath = (name: string): string => {
  return path.join(RECIPES_DIR, `${name}.recipe.json`);
};

export const artifactDir = (name: string): string => {
  return path.join(ARTIFACTS_DIR, name);
};

export const exists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};
