import { type Result, err, ok } from "neverthrow";
import { compileServiceResult } from "../services/compile-service.js";
import { stderrReporter } from "../services/progress.js";
import type { CommandError } from "./result.js";
import { serviceErrorToCommandError } from "./result.js";

type CompileOptions = {
  llmCommand?: string;
};

export const compileCommand = async (name: string, options: CompileOptions): Promise<void> => {
  const result = await compileCommandResult(name, options);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
};

export const compileCommandResult = async (
  name: string,
  options: CompileOptions,
): Promise<Result<void, CommandError>> => {
  const result = await compileServiceResult(name, {
    llmCommand: options.llmCommand,
    progress: stderrReporter,
  });
  if (result.isErr()) {
    return err(serviceErrorToCommandError("compile", result.error));
  }
  return ok(undefined);
};
