import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { getMasterKey, setMasterKey } from "../src/core/keychain.js";

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

const mockError = () => {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(new Error("command failed"), "", "");
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
  });

  describe("macOS (darwin)", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "darwin" });
    });

    it("getMasterKey returns buffer on success", async () => {
      mockSuccess(`${VALID_HEX_KEY}\n`);
      const result = await getMasterKey();
      expect(result).toBeInstanceOf(Buffer);
      expect(result?.length).toBe(32);
      expect(result?.toString("hex")).toBe(VALID_HEX_KEY);

      expect(mockExecFile).toHaveBeenCalledWith(
        "security",
        expect.arrayContaining(["find-generic-password", "-w"]),
        expect.any(Function),
      );
    });

    it("getMasterKey returns null when key not found", async () => {
      mockError();
      expect(await getMasterKey()).toBeNull();
    });

    it("getMasterKey returns null for invalid hex", async () => {
      mockSuccess("not-hex-data\n");
      expect(await getMasterKey()).toBeNull();
    });

    it("getMasterKey returns null for wrong length", async () => {
      mockSuccess("abcd\n");
      expect(await getMasterKey()).toBeNull();
    });

    it("setMasterKey returns true on success", async () => {
      mockSuccess("");
      const result = await setMasterKey(Buffer.alloc(32));
      expect(result).toBe(true);

      expect(mockExecFile).toHaveBeenCalledWith(
        "security",
        expect.arrayContaining(["add-generic-password", "-U"]),
        expect.any(Function),
      );
    });

    it("setMasterKey returns false on failure", async () => {
      mockError();
      expect(await setMasterKey(Buffer.alloc(32))).toBe(false);
    });
  });

  describe("Linux", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "linux" });
    });

    it("getMasterKey returns buffer on success", async () => {
      mockSuccess(`${VALID_HEX_KEY}\n`);
      const result = await getMasterKey();
      expect(result).toBeInstanceOf(Buffer);
      expect(result?.toString("hex")).toBe(VALID_HEX_KEY);

      expect(mockExecFile).toHaveBeenCalledWith(
        "secret-tool",
        expect.arrayContaining(["lookup"]),
        expect.any(Function),
      );
    });

    it("getMasterKey returns null when key not found", async () => {
      mockError();
      expect(await getMasterKey()).toBeNull();
    });

    it("getMasterKey returns null for empty output", async () => {
      mockSuccess("");
      expect(await getMasterKey()).toBeNull();
    });

    it("setMasterKey calls /bin/sh with secret-tool pipe", async () => {
      mockSuccess("");
      const result = await setMasterKey(Buffer.alloc(32));
      expect(result).toBe(true);

      expect(mockExecFile).toHaveBeenCalledWith(
        "/bin/sh",
        expect.arrayContaining(["-c"]),
        expect.any(Function),
      );
    });

    it("setMasterKey returns false on failure", async () => {
      mockError();
      expect(await setMasterKey(Buffer.alloc(32))).toBe(false);
    });
  });
});
