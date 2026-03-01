import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import {
  formatKeychainError,
  getMasterKey,
  getMasterKeyResult,
  setMasterKey,
  setMasterKeyResult,
} from "../src/core/keychain.js";

const mockExecFile = execFile as unknown as Mock;

const VALID_HEX_KEY = "ab".repeat(32); // 64 hex chars = 32 bytes

const mockSuccess = (stdout: string) => {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, stdout, "");
    },
  );
};

const mockError = (code: string | number = "ENOENT") => {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const error = Object.assign(new Error("command failed"), { code });
      callback(error, "", "");
    },
  );
};

describe("keychain", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  describe("unsupported platform", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "win32" });
    });

    it("getMasterKey returns null", async () => {
      expect(await getMasterKey()).toBeNull();
    });

    it("setMasterKey returns false", async () => {
      expect(await setMasterKey(Buffer.alloc(32))).toBe(false);
    });

    it("getMasterKeyResult returns unsupported_platform error", async () => {
      const result = await getMasterKeyResult();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe("unsupported_platform");
        expect(formatKeychainError(result.error)).toMatch(/not supported/);
      }
    });

    it("setMasterKeyResult returns unsupported_platform error", async () => {
      const result = await setMasterKeyResult(Buffer.alloc(32));
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe("unsupported_platform");
      }
    });
  });

  describe("macOS (darwin)", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "darwin" });
    });

    it("getMasterKeyResult returns buffer on success", async () => {
      mockSuccess(`${VALID_HEX_KEY}\n`);
      const result = await getMasterKeyResult();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeInstanceOf(Buffer);
        expect(result.value?.length).toBe(32);
        expect(result.value?.toString("hex")).toBe(VALID_HEX_KEY);
      }

      expect(mockExecFile).toHaveBeenCalledWith(
        "security",
        expect.arrayContaining(["find-generic-password", "-w"]),
        expect.any(Function),
      );
    });

    it("getMasterKeyResult returns command_failed when key lookup fails", async () => {
      mockError("ENOENT");
      const result = await getMasterKeyResult();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe("command_failed");
        expect(formatKeychainError(result.error)).toContain("spawn=ENOENT");
      }
    });

    it("getMasterKeyResult returns invalid_key_format for non-hex", async () => {
      mockSuccess("not-hex-data\n");
      const result = await getMasterKeyResult();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe("invalid_key_format");
        if (result.error.kind === "invalid_key_format") {
          expect(result.error.reason).toBe("non_hex");
        }
      }
    });

    it("getMasterKeyResult returns invalid_key_format for wrong length", async () => {
      mockSuccess("abcd\n");
      const result = await getMasterKeyResult();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe("invalid_key_format");
        if (result.error.kind === "invalid_key_format") {
          expect(result.error.reason).toBe("invalid_length");
        }
      }
    });

    it("setMasterKeyResult returns ok on success", async () => {
      mockSuccess("");
      const result = await setMasterKeyResult(Buffer.alloc(32));
      expect(result.isOk()).toBe(true);

      expect(mockExecFile).toHaveBeenCalledWith(
        "security",
        expect.arrayContaining(["add-generic-password", "-U"]),
        expect.any(Function),
      );
    });

    it("setMasterKeyResult returns command_failed on failure", async () => {
      mockError(1);
      const result = await setMasterKeyResult(Buffer.alloc(32));
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.kind).toBe("command_failed");
        expect(formatKeychainError(result.error)).toContain("exit=1");
      }
    });

    it("compatibility wrappers preserve legacy behavior", async () => {
      mockError("ENOENT");
      expect(await getMasterKey()).toBeNull();
      expect(await setMasterKey(Buffer.alloc(32))).toBe(false);
    });
  });

  describe("Linux", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "linux" });
    });

    it("getMasterKeyResult uses secret-tool backend", async () => {
      mockSuccess(`${VALID_HEX_KEY}\n`);
      const result = await getMasterKeyResult();
      expect(result.isOk()).toBe(true);

      expect(mockExecFile).toHaveBeenCalledWith(
        "secret-tool",
        expect.arrayContaining(["lookup"]),
        expect.any(Function),
      );
    });

    it("setMasterKeyResult uses shell pipeline backend", async () => {
      mockSuccess("");
      const result = await setMasterKeyResult(Buffer.alloc(32));
      expect(result.isOk()).toBe(true);

      expect(mockExecFile).toHaveBeenCalledWith(
        "/bin/sh",
        expect.arrayContaining(["-c"]),
        expect.any(Function),
      );
    });
  });
});
