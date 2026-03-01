import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT_ENV = "BROWREC_PROJECT_ROOT";

const resolveProjectRoot = (): string => {
  const fromEnv = process.env[PROJECT_ROOT_ENV];
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv);
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "../../");
};

const projectRoot = resolveProjectRoot();

export const PROJECT_ROOT = projectRoot;
export const PROJECT_ROOT_ENV_NAME = PROJECT_ROOT_ENV;
export const RECORDINGS_DIR = path.join(projectRoot, "recordings");
export const RECIPES_DIR = path.join(projectRoot, "recipes");
export const ARTIFACTS_DIR = path.join(projectRoot, "artifacts");
export const PUBLIC_DIR = path.join(projectRoot, "public");
export const SECRETS_DIR = path.join(projectRoot, "secrets");
