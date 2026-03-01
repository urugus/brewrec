import { describe, expect, it } from "vitest";
import { formatLocalLlmError, runLocalClaude, runLocalClaudeResult } from "../src/core/llm.js";

describe("llm", () => {
  it("returns typed error when command execution fails", async () => {
    const command = "__browrec_missing_llm_command__";
    const result = await runLocalClaudeResult("hello", command);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe("command_failed");
      expect(result.error.command).toBe(command);
      expect(formatLocalLlmError(result.error)).toContain("LLM command failed");
    }
  });

  it("keeps compatibility wrapper behavior on failure", async () => {
    const output = await runLocalClaude("hello", "__browrec_missing_llm_command__");
    expect(output).toBe("");
  });
});
