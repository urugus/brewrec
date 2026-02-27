import { execFile } from "node:child_process";

const SERVICE_NAME = "browrec-master-key";
const ACCOUNT_NAME = "browrec";

const exec = (command: string, args: string[]): Promise<string> => {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
};

type KeychainBackend = {
  get: () => Promise<string | null>;
  set: (hexKey: string) => Promise<boolean>;
};

const darwinBackend: KeychainBackend = {
  async get() {
    try {
      const stdout = await exec("security", [
        "find-generic-password",
        "-a",
        ACCOUNT_NAME,
        "-s",
        SERVICE_NAME,
        "-w",
      ]);
      const value = stdout.trim();
      return value || null;
    } catch {
      return null;
    }
  },
  async set(hexKey: string) {
    try {
      await exec("security", [
        "add-generic-password",
        "-a",
        ACCOUNT_NAME,
        "-s",
        SERVICE_NAME,
        "-w",
        hexKey,
        "-U",
      ]);
      return true;
    } catch {
      return false;
    }
  },
};

const linuxBackend: KeychainBackend = {
  async get() {
    try {
      const stdout = await exec("secret-tool", [
        "lookup",
        "application",
        ACCOUNT_NAME,
        "type",
        SERVICE_NAME,
      ]);
      const value = stdout.trim();
      return value || null;
    } catch {
      return null;
    }
  },
  async set(hexKey: string) {
    try {
      await exec("/bin/sh", [
        "-c",
        `printf '%s' "${hexKey}" | secret-tool store --label='browrec master key' application ${ACCOUNT_NAME} type ${SERVICE_NAME}`,
      ]);
      return true;
    } catch {
      return false;
    }
  },
};

const getBackend = (): KeychainBackend | null => {
  switch (process.platform) {
    case "darwin":
      return darwinBackend;
    case "linux":
      return linuxBackend;
    default:
      return null;
  }
};

export const getMasterKey = async (): Promise<Buffer | null> => {
  const backend = getBackend();
  if (!backend) return null;

  const hex = await backend.get();
  if (!hex) return null;

  try {
    const buf = Buffer.from(hex, "hex");
    if (buf.length !== 32) return null;
    return buf;
  } catch {
    return null;
  }
};

export const setMasterKey = async (key: Buffer): Promise<boolean> => {
  const backend = getBackend();
  if (!backend) return false;
  return backend.set(key.toString("hex"));
};
