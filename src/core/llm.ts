import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Result, err, ok } from "neverthrow";

const execFileAsync = promisify(execFile);

export type LocalLlmError = {
  kind: "command_failed";
  command: string;
  message: string;
  code?: string | number;
};

export const formatLocalLlmError = (error: LocalLlmError): string => {
  return `LLM command failed (${error.command}): ${error.message}`;
};

const toErrorMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  return String(cause);
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
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? (cause.code as string | number | undefined)
        : undefined;
    return err({
      kind: "command_failed",
      command,
      message: toErrorMessage(cause),
      code,
    });
  }
};

export const runLocalClaude = async (prompt: string, command = "claude"): Promise<string> => {
  const result = await runLocalClaudeResult(prompt, command);
  if (result.isErr()) return "";
  return result.value;
};
