import { err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLaunch = vi.fn();
const mockInjectRecordingCapabilities = vi.fn();
const mockInitRecordingResult = vi.fn();
const mockAppendRecordedEventResult = vi.fn();
const mockFormatRecordStoreError = vi.fn();
const mockSaveSecretResult = vi.fn();
const mockFormatSecretStoreError = vi.fn();

vi.mock("playwright", () => ({
  chromium: {
    launch: (...args: unknown[]) => mockLaunch(...args),
  },
}));

vi.mock("../src/core/init-script.js", () => ({
  injectRecordingCapabilities: (...args: unknown[]) => mockInjectRecordingCapabilities(...args),
}));

vi.mock("../src/core/record-store.js", () => ({
  initRecordingResult: (...args: unknown[]) => mockInitRecordingResult(...args),
  appendRecordedEventResult: (...args: unknown[]) => mockAppendRecordedEventResult(...args),
  formatRecordStoreError: (...args: unknown[]) => mockFormatRecordStoreError(...args),
}));

vi.mock("../src/core/secret-store.js", () => ({
  saveSecretResult: (...args: unknown[]) => mockSaveSecretResult(...args),
  formatSecretStoreError: (...args: unknown[]) => mockFormatSecretStoreError(...args),
}));

import { recordCommand } from "../src/commands/record.js";

const createFakeBrowser = () => {
  const page = {
    on: vi.fn(),
    goto: vi.fn(async () => {}),
    waitForEvent: vi.fn(async () => {}),
  };
  const context = {
    newPage: vi.fn(async () => page),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {}),
  };
  return { browser, context, page };
};

describe("record command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitRecordingResult.mockResolvedValue(ok(undefined));
    mockAppendRecordedEventResult.mockResolvedValue(ok(undefined));
    mockSaveSecretResult.mockResolvedValue(ok(undefined));
    mockFormatRecordStoreError.mockImplementation(
      (error: { kind: string }) => `record:${error.kind}`,
    );
    mockFormatSecretStoreError.mockImplementation(
      (error: { kind: string }) => `secret:${error.kind}`,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws formatted error when recording initialization fails", async () => {
    mockInitRecordingResult.mockResolvedValue(
      err({
        kind: "recording_init_failed",
        recordingName: "sample",
        message: "permission denied",
      }),
    );
    mockFormatRecordStoreError.mockReturnValue("recording-init-error");

    await expect(recordCommand("sample", { url: "https://example.com" })).rejects.toThrow(
      "recording-init-error",
    );
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("throws formatted error when injected event append fails and closes browser", async () => {
    const { browser } = createFakeBrowser();
    mockLaunch.mockResolvedValue(browser);
    mockAppendRecordedEventResult.mockResolvedValue(
      err({
        kind: "recording_append_failed",
        recordingName: "sample",
        message: "write failed",
      }),
    );
    mockFormatRecordStoreError.mockReturnValue("append-failed");
    mockInjectRecordingCapabilities.mockImplementation(
      async (_context: unknown, onEvent: (page: unknown, event: unknown) => Promise<void>) => {
        await onEvent(
          {},
          { ts: "2026-03-01T00:00:00.000Z", type: "click", url: "https://example.com" },
        );
      },
    );

    await expect(recordCommand("sample", { url: "https://example.com" })).rejects.toThrow(
      "append-failed",
    );
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("throws formatted error when secret save fails and closes browser", async () => {
    const { browser } = createFakeBrowser();
    mockLaunch.mockResolvedValue(browser);
    mockInjectRecordingCapabilities.mockImplementation(
      async (
        _context: unknown,
        _onEvent: (page: unknown, event: unknown) => Promise<void>,
        onSecret: ((fieldName: string, value: string) => void) | undefined,
      ) => {
        onSecret?.("password", "s3cret");
      },
    );
    mockSaveSecretResult.mockResolvedValue(
      err({
        kind: "vault_write_failed",
        recipeName: "sample",
        message: "disk full",
      }),
    );
    mockFormatSecretStoreError.mockReturnValue("secret-save-failed");

    await expect(recordCommand("sample", { url: "https://example.com" })).rejects.toThrow(
      "secret-save-failed",
    );
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
