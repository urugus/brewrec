import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");

export const PROJECT_ROOT = projectRoot;
export const RECORDINGS_DIR = path.join(projectRoot, "recordings");
export const RECIPES_DIR = path.join(projectRoot, "recipes");
export const ARTIFACTS_DIR = path.join(projectRoot, "artifacts");
export const PUBLIC_DIR = path.join(projectRoot, "public");
