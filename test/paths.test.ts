import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const PATHS_MODULE_PATH = "../src/core/paths.js";
const PROJECT_ROOT_ENV = "BROWREC_PROJECT_ROOT";
const originalProjectRootEnv = process.env[PROJECT_ROOT_ENV];

const loadPathsModule = async (): Promise<typeof import("../src/core/paths.js")> => {
  vi.resetModules();
  return import(PATHS_MODULE_PATH);
};

afterEach(() => {
  if (originalProjectRootEnv === undefined) {
    delete process.env[PROJECT_ROOT_ENV];
    return;
  }
  process.env[PROJECT_ROOT_ENV] = originalProjectRootEnv;
});

describe("project root resolution", () => {
  it("uses environment override when set", async () => {
    process.env[PROJECT_ROOT_ENV] = "./tmp/custom-project-root";

    const paths = await loadPathsModule();
    const expectedRoot = path.resolve("./tmp/custom-project-root");

    expect(paths.PROJECT_ROOT_ENV_NAME).toBe(PROJECT_ROOT_ENV);
    expect(paths.PROJECT_ROOT).toBe(expectedRoot);
    expect(paths.RECIPES_DIR).toBe(path.join(expectedRoot, "recipes"));
    expect(paths.RECORDINGS_DIR).toBe(path.join(expectedRoot, "recordings"));
    expect(paths.ARTIFACTS_DIR).toBe(path.join(expectedRoot, "artifacts"));
    expect(paths.SECRETS_DIR).toBe(path.join(expectedRoot, "secrets"));
  });

  it("falls back to module-relative root when override is missing", async () => {
    delete process.env[PROJECT_ROOT_ENV];

    const paths = await loadPathsModule();
    const sourceFile = fileURLToPath(new URL("../src/core/paths.ts", import.meta.url));
    const expectedRoot = path.resolve(path.dirname(sourceFile), "../../");

    expect(paths.PROJECT_ROOT).toBe(expectedRoot);
  });

  it("ignores blank environment override", async () => {
    process.env[PROJECT_ROOT_ENV] = "   ";

    const paths = await loadPathsModule();
    const sourceFile = fileURLToPath(new URL("../src/core/paths.ts", import.meta.url));
    const expectedRoot = path.resolve(path.dirname(sourceFile), "../../");

    expect(paths.PROJECT_ROOT).toBe(expectedRoot);
  });
});
