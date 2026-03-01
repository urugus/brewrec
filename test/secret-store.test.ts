import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { err, ok } from "neverthrow";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetMasterKeyResult = vi.fn<() => Promise<unknown>>();
const mockSetMasterKeyResult = vi.fn<(key: Buffer) => Promise<unknown>>();

vi.mock("../src/core/keychain.js", () => ({
  getMasterKeyResult: (...args: Parameters<typeof mockGetMasterKeyResult>) =>
    mockGetMasterKeyResult(...args),
  setMasterKeyResult: (...args: Parameters<typeof mockSetMasterKeyResult>) =>
    mockSetMasterKeyResult(...args),
}));

import { vaultPath } from "../src/core/fs.js";
import {
  _resetKeyCache,
  formatSecretStoreError,
  loadSecret,
  loadSecretResult,
  saveSecret,
  saveSecretResult,
} from "../src/core/secret-store.js";

const TEST_RECIPE = "test-secret-recipe";
const vaultFile = vaultPath(TEST_RECIPE);

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
    mockGetMasterKeyResult.mockResolvedValue(ok(null));
    mockSetMasterKeyResult.mockResolvedValue(
      err({ kind: "unsupported_platform", platform: "linux" }),
    );
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
    await fs.mkdir(path.dirname(vaultFile), { recursive: true });
    await fs.writeFile(vaultFile, "not valid json", "utf-8");
    const result = await loadSecret(TEST_RECIPE, "password");
    expect(result).toBeUndefined();
  });

  it("returns typed error for corrupted vault in result API", async () => {
    await fs.mkdir(path.dirname(vaultFile), { recursive: true });
    await fs.writeFile(vaultFile, "not valid json", "utf-8");
    const result = await loadSecretResult(TEST_RECIPE, "password");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("vault_parse_failed");
      expect(formatSecretStoreError(result.error)).toMatch(/Secret vault parse failed/);
    }
  });

  it("returns typed error for invalid vault shape in result API", async () => {
    await fs.mkdir(path.dirname(vaultFile), { recursive: true });
    await fs.writeFile(vaultFile, "{}", "utf-8");
    const result = await loadSecretResult(TEST_RECIPE, "password");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("vault_parse_failed");
    }
  });

  it("returns undefined for invalid vault shape in compatibility API", async () => {
    await fs.mkdir(path.dirname(vaultFile), { recursive: true });
    await fs.writeFile(vaultFile, "{}", "utf-8");
    const result = await loadSecret(TEST_RECIPE, "password");
    expect(result).toBeUndefined();
  });

  it("returns ok from saveSecretResult and persists encrypted entry", async () => {
    const result = await saveSecretResult(TEST_RECIPE, "token", "abc123");
    expect(result.isOk()).toBe(true);
    const raw = await fs.readFile(vaultFile, "utf-8");
    const vault = JSON.parse(raw);
    expect(vault.entries.token).toBeDefined();
    expect(vault.entries.token.ciphertext).not.toContain("abc123");
  });

  it("returns typed parse error from saveSecretResult on corrupted vault", async () => {
    await fs.mkdir(path.dirname(vaultFile), { recursive: true });
    await fs.writeFile(vaultFile, "not valid json", "utf-8");
    const result = await saveSecretResult(TEST_RECIPE, "token", "abc123");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("vault_parse_failed");
    }
  });

  it("returns derive_key_failed from saveSecretResult when legacy key derivation fails", async () => {
    _resetKeyCache();
    mockGetMasterKeyResult.mockResolvedValue(ok(null));
    mockSetMasterKeyResult.mockResolvedValue(
      err({ kind: "unsupported_platform", platform: "linux" }),
    );
    const userInfoSpy = vi.spyOn(os, "userInfo").mockImplementation(() => {
      throw new Error("user unavailable");
    });

    try {
      const result = await saveSecretResult(TEST_RECIPE, "token", "abc123");
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe("derive_key_failed");
      }
    } finally {
      userInfoSpy.mockRestore();
    }
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
      mockGetMasterKeyResult.mockResolvedValue(ok(FAKE_MASTER_KEY));
      mockSetMasterKeyResult.mockResolvedValue(ok(undefined));
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
      mockGetMasterKeyResult.mockResolvedValue(ok(null));
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
      mockGetMasterKeyResult.mockResolvedValue(ok(masterKey));
      mockSetMasterKeyResult.mockResolvedValue(ok(undefined));

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
      mockGetMasterKeyResult.mockResolvedValue(ok(null));
      mockSetMasterKeyResult.mockResolvedValue(ok(undefined));

      await saveSecret(TEST_RECIPE, "password", "first-use");
      expect(mockSetMasterKeyResult).toHaveBeenCalledTimes(1);
      const storedKey = mockSetMasterKeyResult.mock.calls[0][0];
      expect(storedKey).toBeInstanceOf(Buffer);
      expect(storedKey.length).toBe(32);
    });

    it("caches master key within process", async () => {
      _resetKeyCache();
      const masterKey = crypto.randomBytes(32);
      mockGetMasterKeyResult.mockResolvedValue(ok(masterKey));

      await saveSecret(TEST_RECIPE, "password", "value1");
      await saveSecret(TEST_RECIPE, "email", "value2");
      await loadSecret(TEST_RECIPE, "password");

      // getMasterKey should be called only once despite multiple operations
      expect(mockGetMasterKeyResult).toHaveBeenCalledTimes(1);
    });
  });
});
