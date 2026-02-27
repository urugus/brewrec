import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetMasterKey = vi.fn<() => Promise<Buffer | null>>();
const mockSetMasterKey = vi.fn<(key: Buffer) => Promise<boolean>>();

vi.mock("../src/core/keychain.js", () => ({
  getMasterKey: (...args: Parameters<typeof mockGetMasterKey>) => mockGetMasterKey(...args),
  setMasterKey: (...args: Parameters<typeof mockSetMasterKey>) => mockSetMasterKey(...args),
}));

import { _resetKeyCache, loadSecret, saveSecret } from "../src/core/secret-store.js";

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
  beforeEach(async () => {
    await cleanup();
    vi.clearAllMocks();
    _resetKeyCache();
    // Default: keychain unavailable → legacy fallback
    mockGetMasterKey.mockResolvedValue(null);
    mockSetMasterKey.mockResolvedValue(false);
  });
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

  describe("with keychain available", () => {
    const FAKE_MASTER_KEY = crypto.randomBytes(32);

    beforeEach(() => {
      _resetKeyCache();
      mockGetMasterKey.mockResolvedValue(FAKE_MASTER_KEY);
      mockSetMasterKey.mockResolvedValue(true);
    });

    it("encrypts and decrypts using keychain-derived key", async () => {
      await saveSecret(TEST_RECIPE, "password", "keychain-secret");
      const result = await loadSecret(TEST_RECIPE, "password");
      expect(result).toBe("keychain-secret");
    });

    it("produces different ciphertext than legacy key", async () => {
      await saveSecret(TEST_RECIPE, "password", "test-value");
      const keychainRaw = await fs.readFile(vaultFile, "utf-8");
      const keychainVault = JSON.parse(keychainRaw);

      // Now save with legacy (keychain unavailable)
      _resetKeyCache();
      mockGetMasterKey.mockResolvedValue(null);
      await cleanup();
      await saveSecret(TEST_RECIPE, "password", "test-value");
      const legacyRaw = await fs.readFile(vaultFile, "utf-8");
      const legacyVault = JSON.parse(legacyRaw);

      // Different keys produce different ciphertext (with overwhelming probability)
      expect(keychainVault.entries.password.ciphertext).not.toBe(
        legacyVault.entries.password.ciphertext,
      );
    });
  });

  describe("transparent migration", () => {
    it("migrates legacy-encrypted vault to keychain key", async () => {
      // Step 1: Save with legacy key (keychain unavailable)
      await saveSecret(TEST_RECIPE, "password", "migrate-me");
      const legacyRaw = await fs.readFile(vaultFile, "utf-8");
      const legacyCiphertext = JSON.parse(legacyRaw).entries.password.ciphertext;

      // Step 2: Enable keychain and load — should trigger migration
      _resetKeyCache();
      const masterKey = crypto.randomBytes(32);
      mockGetMasterKey.mockResolvedValue(masterKey);
      mockSetMasterKey.mockResolvedValue(true);

      const result = await loadSecret(TEST_RECIPE, "password");
      expect(result).toBe("migrate-me");

      // Step 3: Vault should now be re-encrypted with the new key
      const migratedRaw = await fs.readFile(vaultFile, "utf-8");
      const migratedCiphertext = JSON.parse(migratedRaw).entries.password.ciphertext;
      expect(migratedCiphertext).not.toBe(legacyCiphertext);

      // Step 4: Subsequent load should work with the new key directly
      const result2 = await loadSecret(TEST_RECIPE, "password");
      expect(result2).toBe("migrate-me");
    });
  });

  describe("master key generation", () => {
    it("generates and stores a new key on first use", async () => {
      _resetKeyCache();
      mockGetMasterKey.mockResolvedValue(null);
      mockSetMasterKey.mockResolvedValue(true);

      await saveSecret(TEST_RECIPE, "password", "first-use");
      expect(mockSetMasterKey).toHaveBeenCalledTimes(1);
      const storedKey = mockSetMasterKey.mock.calls[0][0];
      expect(storedKey).toBeInstanceOf(Buffer);
      expect(storedKey.length).toBe(32);
    });

    it("caches master key within process", async () => {
      _resetKeyCache();
      const masterKey = crypto.randomBytes(32);
      mockGetMasterKey.mockResolvedValue(masterKey);

      await saveSecret(TEST_RECIPE, "password", "value1");
      await saveSecret(TEST_RECIPE, "email", "value2");
      await loadSecret(TEST_RECIPE, "password");

      // getMasterKey should be called only once despite multiple operations
      expect(mockGetMasterKey).toHaveBeenCalledTimes(1);
    });
  });
});
