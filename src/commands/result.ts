export type CommandName = "record" | "compile" | "run" | "plan" | "debug" | "repair";

export type CommandError = {
  command: CommandName;
  message: string;
};

const causeMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  return String(cause);
};

export const toCommandError = (command: CommandName, cause: unknown): CommandError => {
  return { command, message: causeMessage(cause) };
};

export const formatCommandError = (error: CommandError): string => {
  return `[${error.command}] ${error.message}`;
};
