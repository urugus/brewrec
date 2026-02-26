import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const runLocalClaude = async (prompt: string, command = "claude"): Promise<string> => {
  try {
    const { stdout } = await execFileAsync(command, ["-p", prompt], {
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return "";
  }
};
