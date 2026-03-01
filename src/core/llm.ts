import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Result, err, ok } from "neverthrow";

const execFileAsync = promisify(execFile);

export type LocalLlmError = {
  kind: "command_failed";
  command: string;
  reason: "spawn_error" | "exit_code" | "signal" | "unknown";
  code?: string | number;
  signal?: string;
};

export const formatLocalLlmError = (error: LocalLlmError): string => {
  const details: string[] = [];
  if (error.reason === "spawn_error" && typeof error.code === "string") {
    details.push(`spawn=${error.code}`);
  } else if (error.reason === "exit_code" && typeof error.code === "number") {
    details.push(`exit=${error.code}`);
  } else if (error.reason === "signal" && error.signal) {
    details.push(`signal=${error.signal}`);
  } else if (error.code !== undefined) {
    details.push(`code=${String(error.code)}`);
  }

  if (details.length === 0) {
    return `LLM command failed (${error.command})`;
  }
  return `LLM command failed (${error.command}): ${details.join(", ")}`;
};

const parseProcessFailure = (
  cause: unknown,
): { reason: LocalLlmError["reason"]; code?: string | number; signal?: string } => {
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

export const runLocalClaudeResult = async (
  prompt: string,
  command = "claude",
): Promise<Result<string, LocalLlmError>> => {
  try {
    const { stdout } = await execFileAsync(command, ["-p", prompt], {
      maxBuffer: 4 * 1024 * 1024,
    });
    return ok(stdout.trim());
  } catch (cause) {
    const failure = parseProcessFailure(cause);
    return err({
      kind: "command_failed",
      command,
      reason: failure.reason,
      code: failure.code,
      signal: failure.signal,
    });
  }
};

export const runLocalClaude = async (prompt: string, command = "claude"): Promise<string> => {
  const result = await runLocalClaudeResult(prompt, command);
  if (result.isErr()) return "";
  return result.value;
};
