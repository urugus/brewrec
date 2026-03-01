import { type Result, err, ok } from "neverthrow";
import { repairServiceResult } from "../services/repair-service.js";
import type { CommandError } from "./result.js";
import { serviceErrorToCommandError } from "./result.js";

export const repairCommand = async (name: string): Promise<void> => {
  const result = await repairCommandResult(name);
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
};

export const repairCommandResult = async (name: string): Promise<Result<void, CommandError>> => {
  const result = await repairServiceResult(name);
  if (result.isErr()) {
    return err(serviceErrorToCommandError("repair", result.error));
  }
  return ok(undefined);
};
