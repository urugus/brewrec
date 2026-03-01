import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import { type Result, err, ok } from "neverthrow";
import { exists, vaultPath } from "./fs.js";
import { getMasterKeyResult, setMasterKeyResult } from "./keychain.js";
import { SECRETS_DIR } from "./paths.js";

type VaultEntry = {
  iv: string;
  tag: string;
  ciphertext: string;
};

type Vault = {
  version: number;
  entries: Record<string, VaultEntry>;
};

export type SecretStoreError =
  | {
      kind: "vault_read_failed";
      recipeName: string;
      message: string;
    }
  | {
      kind: "vault_parse_failed";
      recipeName: string;
      message: string;
    }
  | {
      kind: "vault_write_failed";
      recipeName: string;
      message: string;
    }
  | {
      kind: "derive_key_failed";
      message: string;
    }
  | {
      kind: "encrypt_failed";
      variableName: string;
      message: string;
    };

export const formatSecretStoreError = (error: SecretStoreError): string => {
  if (error.kind === "vault_read_failed") {
    return `Secret vault read failed (${error.recipeName}): ${error.message}`;
  }
  if (error.kind === "vault_parse_failed") {
    return `Secret vault parse failed (${error.recipeName}): ${error.message}`;
  }
  if (error.kind === "vault_write_failed") {
    return `Secret vault write failed (${error.recipeName}): ${error.message}`;
  }
  if (error.kind === "derive_key_failed") {
    return `Secret key derivation failed: ${error.message}`;
  }
  return `Secret encrypt failed (${error.variableName}): ${error.message}`;
};

const causeMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  return String(cause);
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isVaultEntry = (value: unknown): value is VaultEntry => {
  if (!isObject(value)) return false;
  return (
    typeof value.iv === "string" &&
    typeof value.tag === "string" &&
    typeof value.ciphertext === "string"
  );
};

const isVault = (value: unknown): value is Vault => {
  if (!isObject(value)) return false;
  if (typeof value.version !== "number") return false;
  if (!isObject(value.entries)) return false;
  return Object.values(value.entries).every((entry) => isVaultEntry(entry));
};

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 16;
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32;

let cachedMasterKey: Buffer | null | undefined;

const getOrCreateMasterKey = async (): Promise<Buffer | null> => {
  if (cachedMasterKey !== undefined) return cachedMasterKey;

  const masterKeyResult = await getMasterKeyResult();
  let masterKey = masterKeyResult.isOk() ? masterKeyResult.value : null;
  if (!masterKey) {
    const newKey = crypto.randomBytes(KEY_LENGTH);
    const setResult = await setMasterKeyResult(newKey);
    if (setResult.isOk()) {
      masterKey = newKey;
    }
  }
  cachedMasterKey = masterKey;
  return masterKey;
};

const deriveKeyFromMaterial = (material: string): Buffer => {
  const salt = `browrec-vault-v1:${material}`;
  return crypto.pbkdf2Sync(material, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
};

const legacyDeriveKey = (): Buffer => {
  const material = `${os.hostname()}:${os.userInfo().username}`;
  return deriveKeyFromMaterial(material);
};

const deriveKeyResult = async (): Promise<Result<Buffer, SecretStoreError>> => {
  try {
    const masterKey = await getOrCreateMasterKey();
    if (masterKey) {
      return ok(deriveKeyFromMaterial(masterKey.toString("hex")));
    }
    return ok(legacyDeriveKey());
  } catch (cause) {
    return err({ kind: "derive_key_failed", message: causeMessage(cause) });
  }
};

const encryptResult = (
  variableName: string,
  plaintext: string,
  key: Buffer,
): Result<VaultEntry, SecretStoreError> => {
  try {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ok({
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      ciphertext: encrypted.toString("hex"),
    });
  } catch (cause) {
    return err({ kind: "encrypt_failed", variableName, message: causeMessage(cause) });
  }
};

const decrypt = (entry: VaultEntry, key: Buffer): string => {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(entry.iv, "hex"));
  decipher.setAuthTag(Buffer.from(entry.tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
};

const readVaultResult = async (recipeName: string): Promise<Result<Vault, SecretStoreError>> => {
  const p = vaultPath(recipeName);
  if (!(await exists(p))) {
    return ok({ version: 1, entries: {} });
  }

  let raw = "";
  try {
    raw = await fs.readFile(p, "utf-8");
  } catch (cause) {
    return err({ kind: "vault_read_failed", recipeName, message: causeMessage(cause) });
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isVault(parsed)) {
      return err({
        kind: "vault_parse_failed",
        recipeName,
        message: "vault has invalid shape",
      });
    }
    return ok(parsed);
  } catch (cause) {
    return err({ kind: "vault_parse_failed", recipeName, message: causeMessage(cause) });
  }
};

const writeVaultResult = async (
  recipeName: string,
  vault: Vault,
): Promise<Result<void, SecretStoreError>> => {
  try {
    await fs.mkdir(SECRETS_DIR, { recursive: true });
    await fs.writeFile(vaultPath(recipeName), JSON.stringify(vault, null, 2), "utf-8");
    return ok(undefined);
  } catch (cause) {
    return err({ kind: "vault_write_failed", recipeName, message: causeMessage(cause) });
  }
};

export const loadSecretResult = async (
  recipeName: string,
  variableName: string,
): Promise<Result<string | undefined, SecretStoreError>> => {
  const vaultResult = await readVaultResult(recipeName);
  if (vaultResult.isErr()) return err(vaultResult.error);

  const vault = vaultResult.value;
  const entry = vault.entries[variableName];
  if (!entry) return ok(undefined);

  const keyResult = await deriveKeyResult();
  if (keyResult.isErr()) return err(keyResult.error);
  const key = keyResult.value;

  try {
    return ok(decrypt(entry, key));
  } catch {
    // Primary key failed — try legacy key for transparent migration
    let legacyKey: Buffer;
    try {
      legacyKey = legacyDeriveKey();
    } catch (cause) {
      return err({ kind: "derive_key_failed", message: causeMessage(cause) });
    }

    try {
      const plaintext = decrypt(entry, legacyKey);
      // Re-encrypt with new key (best-effort; return plaintext regardless)
      const encryptedResult = encryptResult(variableName, plaintext, key);
      if (encryptedResult.isOk()) {
        vault.entries[variableName] = encryptedResult.value;
        await writeVaultResult(recipeName, vault);
      }
      return ok(plaintext);
    } catch {
      return ok(undefined);
    }
  }
};

export const saveSecretResult = async (
  recipeName: string,
  variableName: string,
  plaintext: string,
): Promise<Result<void, SecretStoreError>> => {
  const vaultResult = await readVaultResult(recipeName);
  if (vaultResult.isErr()) return err(vaultResult.error);

  const keyResult = await deriveKeyResult();
  if (keyResult.isErr()) return err(keyResult.error);

  const encryptedResult = encryptResult(variableName, plaintext, keyResult.value);
  if (encryptedResult.isErr()) return err(encryptedResult.error);

  const vault = vaultResult.value;
  vault.entries[variableName] = encryptedResult.value;
  return writeVaultResult(recipeName, vault);
};

export const loadSecret = async (
  recipeName: string,
  variableName: string,
): Promise<string | undefined> => {
  const result = await loadSecretResult(recipeName, variableName);
  if (result.isErr()) return undefined;
  return result.value;
};

export const saveSecret = async (
  recipeName: string,
  variableName: string,
  plaintext: string,
): Promise<void> => {
  const result = await saveSecretResult(recipeName, variableName, plaintext);
  if (result.isErr()) {
    throw new Error(formatSecretStoreError(result.error));
  }
};

/** @internal — reset cached master key (for tests) */
export const _resetKeyCache = (): void => {
  cachedMasterKey = undefined;
};
