import { execFile } from "node:child_process";
import { type Result, err, ok } from "neverthrow";

const SERVICE_NAME = "browrec-master-key";
const ACCOUNT_NAME = "browrec";

type KeychainBackendName = "darwin" | "linux";

type ProcessFailure = {
  code?: string | number;
  signal?: string;
  reason: "spawn_error" | "exit_code" | "signal" | "unknown";
};

export type KeychainError =
  | {
      kind: "unsupported_platform";
      platform: NodeJS.Platform;
    }
  | {
      kind: "command_failed";
      backend: KeychainBackendName;
      operation: "get" | "set";
      failure: ProcessFailure;
    }
  | {
      kind: "invalid_key_format";
      value: string;
      reason: "non_hex" | "invalid_length";
    };

export const formatKeychainError = (error: KeychainError): string => {
  if (error.kind === "unsupported_platform") {
    return `Keychain backend is not supported on platform: ${error.platform}`;
  }

  if (error.kind === "invalid_key_format") {
    if (error.reason === "non_hex") {
      return "Keychain key format is invalid: non-hex value";
    }
    return "Keychain key format is invalid: expected 32-byte hex";
  }

  const details: string[] = [];
  if (error.failure.reason === "spawn_error" && typeof error.failure.code === "string") {
    details.push(`spawn=${error.failure.code}`);
  } else if (error.failure.reason === "exit_code" && typeof error.failure.code === "number") {
    details.push(`exit=${error.failure.code}`);
  } else if (error.failure.reason === "signal" && error.failure.signal) {
    details.push(`signal=${error.failure.signal}`);
  } else if (error.failure.code !== undefined) {
    details.push(`code=${String(error.failure.code)}`);
  }

  const suffix = details.length > 0 ? `: ${details.join(", ")}` : "";
  return `Keychain command failed (${error.backend}/${error.operation})${suffix}`;
};

const parseProcessFailure = (cause: unknown): ProcessFailure => {
  if (typeof cause !== "object" || cause === null) {
    return { reason: "unknown" };
  }

  const code = "code" in cause ? (cause.code as string | number | undefined) : undefined;
  const signal = "signal" in cause ? (cause.signal as string | undefined) : undefined;

  if (typeof code === "string") return { reason: "spawn_error", code, signal };
  if (typeof code === "number") return { reason: "exit_code", code, signal };
  if (signal) return { reason: "signal", signal };
  return { reason: "unknown", code, signal };
};

const execResult = async (
  command: string,
  args: string[],
  context: { backend: KeychainBackendName; operation: "get" | "set" },
): Promise<Result<string, KeychainError>> => {
  return new Promise((resolve) => {
    execFile(command, args, (error, stdout) => {
      if (error) {
        resolve(
          err({
            kind: "command_failed",
            backend: context.backend,
            operation: context.operation,
            failure: parseProcessFailure(error),
          }),
        );
        return;
      }
      resolve(ok(stdout));
    });
  });
};

type KeychainBackend = {
  name: KeychainBackendName;
  get: () => Promise<Result<string | null, KeychainError>>;
  set: (hexKey: string) => Promise<Result<void, KeychainError>>;
};

const darwinBackend: KeychainBackend = {
  name: "darwin",
  async get() {
    const result = await execResult(
      "security",
      ["find-generic-password", "-a", ACCOUNT_NAME, "-s", SERVICE_NAME, "-w"],
      { backend: "darwin", operation: "get" },
    );
    if (result.isErr()) return err(result.error);

    const value = result.value.trim();
    return ok(value || null);
  },
  async set(hexKey: string) {
    const result = await execResult(
      "security",
      ["add-generic-password", "-a", ACCOUNT_NAME, "-s", SERVICE_NAME, "-w", hexKey, "-U"],
      { backend: "darwin", operation: "set" },
    );
    if (result.isErr()) return err(result.error);
    return ok(undefined);
  },
};

const linuxBackend: KeychainBackend = {
  name: "linux",
  async get() {
    const result = await execResult(
      "secret-tool",
      ["lookup", "application", ACCOUNT_NAME, "type", SERVICE_NAME],
      { backend: "linux", operation: "get" },
    );
    if (result.isErr()) return err(result.error);

    const value = result.value.trim();
    return ok(value || null);
  },
  async set(hexKey: string) {
    const result = await execResult(
      "/bin/sh",
      [
        "-c",
        `printf '%s' '${hexKey}' | secret-tool store --label='browrec master key' application ${ACCOUNT_NAME} type ${SERVICE_NAME}`,
      ],
      { backend: "linux", operation: "set" },
    );
    if (result.isErr()) return err(result.error);
    return ok(undefined);
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

const parseHexKey = (hex: string): Result<Buffer, KeychainError> => {
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
    return err({ kind: "invalid_key_format", value: trimmed, reason: "non_hex" });
  }

  const buf = Buffer.from(trimmed, "hex");
  if (buf.length !== 32) {
    return err({ kind: "invalid_key_format", value: trimmed, reason: "invalid_length" });
  }

  return ok(buf);
};

export const getMasterKeyResult = async (): Promise<Result<Buffer | null, KeychainError>> => {
  const backend = getBackend();
  if (!backend) {
    return err({ kind: "unsupported_platform", platform: process.platform });
  }

  const hexResult = await backend.get();
  if (hexResult.isErr()) return err(hexResult.error);
  if (!hexResult.value) return ok(null);

  const parsed = parseHexKey(hexResult.value);
  if (parsed.isErr()) return err(parsed.error);
  return ok(parsed.value);
};

export const setMasterKeyResult = async (key: Buffer): Promise<Result<void, KeychainError>> => {
  const backend = getBackend();
  if (!backend) {
    return err({ kind: "unsupported_platform", platform: process.platform });
  }

  return backend.set(key.toString("hex"));
};

export const getMasterKey = async (): Promise<Buffer | null> => {
  const result = await getMasterKeyResult();
  if (result.isErr()) return null;
  return result.value;
};

export const setMasterKey = async (key: Buffer): Promise<boolean> => {
  const result = await setMasterKeyResult(key);
  return result.isOk();
};
