import { spawn } from "node:child_process";
import { type Result, err, ok } from "neverthrow";

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

const DEFAULT_TIMEOUT_MS = 120_000;

const spawnWithStdin = (
  command: string,
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ stdout: string; code: number | null; signal: string | null }> => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject({ code: undefined, signal: "SIGTERM", message: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject({ code: e.code, signal: undefined });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, code, signal });
      } else {
        reject({ code, signal, stderr });
      }
    });
    child.stdin.write(input);
    child.stdin.end();
  });
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
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Result<string, LocalLlmError>> => {
  try {
    const { CLAUDECODE, ...cleanEnv } = process.env;
    const { stdout } = await spawnWithStdin(command, ["-p", "-"], prompt, cleanEnv, timeoutMs);
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
