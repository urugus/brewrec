import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSecret, saveSecret } from "../src/core/secret-store.js";

const TEST_SECRETS_DIR = path.join(process.cwd(), "secrets");
const TEST_RECIPE = "test-secret-recipe";
const vaultFile = path.join(TEST_SECRETS_DIR, `${TEST_RECIPE}.vault.json`);

const cleanup = async (): Promise<void> => {
  try {
    await fs.unlink(vaultFile);
  } catch {
    // ignore
  }
};

describe("secret-store", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("encrypts and decrypts a secret round-trip", async () => {
    await saveSecret(TEST_RECIPE, "password", "my-secret-password");
    const result = await loadSecret(TEST_RECIPE, "password");
    expect(result).toBe("my-secret-password");
  });

  it("returns undefined for non-existent secret", async () => {
    const result = await loadSecret(TEST_RECIPE, "nonexistent");
    expect(result).toBeUndefined();
  });

  it("returns undefined for non-existent vault", async () => {
    const result = await loadSecret("no-such-recipe", "password");
    expect(result).toBeUndefined();
  });

  it("overwrites existing secret", async () => {
    await saveSecret(TEST_RECIPE, "password", "old-value");
    await saveSecret(TEST_RECIPE, "password", "new-value");
    const result = await loadSecret(TEST_RECIPE, "password");
    expect(result).toBe("new-value");
  });

  it("stores multiple secrets independently", async () => {
    await saveSecret(TEST_RECIPE, "email", "user@example.com");
    await saveSecret(TEST_RECIPE, "password", "secret123");
    expect(await loadSecret(TEST_RECIPE, "email")).toBe("user@example.com");
    expect(await loadSecret(TEST_RECIPE, "password")).toBe("secret123");
  });

  it("handles corrupted vault gracefully", async () => {
    await fs.mkdir(TEST_SECRETS_DIR, { recursive: true });
    await fs.writeFile(vaultFile, "not valid json", "utf-8");
    const result = await loadSecret(TEST_RECIPE, "password");
    expect(result).toBeUndefined();
  });

  it("vault file contains encrypted data, not plaintext", async () => {
    await saveSecret(TEST_RECIPE, "password", "super-secret");
    const raw = await fs.readFile(vaultFile, "utf-8");
    expect(raw).not.toContain("super-secret");
    const vault = JSON.parse(raw);
    expect(vault.version).toBe(1);
    expect(vault.entries.password).toHaveProperty("iv");
    expect(vault.entries.password).toHaveProperty("tag");
    expect(vault.entries.password).toHaveProperty("ciphertext");
  });
});
