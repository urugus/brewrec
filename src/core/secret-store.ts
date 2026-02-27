import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import { exists, vaultPath } from "./fs.js";
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

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 16;
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32;

const deriveKey = (): Buffer => {
  const material = `${os.hostname()}:${os.userInfo().username}`;
  const salt = `browrec-vault-v1:${material}`;
  return crypto.pbkdf2Sync(material, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
};

const encrypt = (plaintext: string, key: Buffer): VaultEntry => {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: encrypted.toString("hex"),
  };
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

const readVault = async (recipeName: string): Promise<Vault> => {
  const p = vaultPath(recipeName);
  if (!(await exists(p))) {
    return { version: 1, entries: {} };
  }
  const raw = await fs.readFile(p, "utf-8");
  return JSON.parse(raw) as Vault;
};

const writeVault = async (recipeName: string, vault: Vault): Promise<void> => {
  await fs.mkdir(SECRETS_DIR, { recursive: true });
  await fs.writeFile(vaultPath(recipeName), JSON.stringify(vault, null, 2), "utf-8");
};

export const loadSecret = async (
  recipeName: string,
  variableName: string,
): Promise<string | undefined> => {
  try {
    const vault = await readVault(recipeName);
    const entry = vault.entries[variableName];
    if (!entry) return undefined;
    return decrypt(entry, deriveKey());
  } catch {
    return undefined;
  }
};

export const saveSecret = async (
  recipeName: string,
  variableName: string,
  plaintext: string,
): Promise<void> => {
  const vault = await readVault(recipeName);
  vault.entries[variableName] = encrypt(plaintext, deriveKey());
  await writeVault(recipeName, vault);
};
