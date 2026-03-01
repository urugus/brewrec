#!/usr/bin/env node
import { Command } from "commander";
import { compileCommandResult } from "./commands/compile.js";
import { debugCommandResult } from "./commands/debug.js";
import { recordCommandResult } from "./commands/record.js";
import { repairCommandResult } from "./commands/repair.js";
import { formatCommandError } from "./commands/result.js";
import { runCommandResult } from "./commands/run.js";
import { startUiServer } from "./ui/server.js";

const program = new Command();
const collectOptionValues = (value: string, previous: string[]): string[] => [...previous, value];
const ensureCommandSucceeded = async (
  commandResult: Awaited<ReturnType<typeof recordCommandResult>>,
): Promise<void> => {
  if (commandResult.isErr()) {
    throw new Error(formatCommandError(commandResult.error));
  }
};

program.name("browrec").description("Browser record/compile/run CLI").version("0.2.0");

program
  .command("record")
  .argument("<name>", "recording name")
  .option("--url <url>", "start url", "https://example.com")
  .action(async (name: string, options: { url: string }) => {
    await ensureCommandSucceeded(await recordCommandResult(name, options));
  });

program
  .command("compile")
  .argument("<name>", "recording name")
  .option("--llm-command <cmd>", "local llm command", "claude")
  .action(async (name: string, options: { llmCommand: string }) => {
    await ensureCommandSucceeded(await compileCommandResult(name, options));
  });

program
  .command("run")
  .argument("<name>", "recipe name")
  .option("--json", "json output", false)
  .option("--plan-only", "build execution plan and exit", false)
  .option("--heal", "enable self-healing mode", false)
  .option("--llm-command <cmd>", "local llm command for prompted variables", "claude")
  .option("--var <key=value>", "runtime variable (repeatable)", collectOptionValues, [])
  .action(
    async (
      name: string,
      options: {
        json: boolean;
        var: string[];
        llmCommand: string;
        planOnly: boolean;
        heal: boolean;
      },
    ) => {
      await ensureCommandSucceeded(
        await runCommandResult(name, {
          json: options.json,
          vars: options.var,
          llmCommand: options.llmCommand,
          planOnly: options.planOnly,
          heal: options.heal,
        }),
      );
    },
  );

program
  .command("plan")
  .argument("<name>", "recipe name")
  .option("--llm-command <cmd>", "local llm command for prompted variables", "claude")
  .option("--var <key=value>", "runtime variable (repeatable)", collectOptionValues, [])
  .action(async (name: string, options: { var: string[]; llmCommand: string }) => {
    await ensureCommandSucceeded(
      await runCommandResult(name, {
        json: true,
        vars: options.var,
        llmCommand: options.llmCommand,
        planOnly: true,
      }),
    );
  });

program
  .command("debug")
  .argument("<name>", "recipe name")
  .option("--llm-command <cmd>", "local llm command for prompted variables", "claude")
  .option("--var <key=value>", "runtime variable (repeatable)", collectOptionValues, [])
  .action(async (name: string, options: { var: string[]; llmCommand: string }) => {
    await ensureCommandSucceeded(
      await debugCommandResult(name, { vars: options.var, llmCommand: options.llmCommand }),
    );
  });

program
  .command("repair")
  .argument("<name>", "recipe name")
  .action(async (name: string) => {
    await ensureCommandSucceeded(await repairCommandResult(name));
  });

program
  .command("ui")
  .option("--port <port>", "port", "4312")
  .action(async (options: { port: string }) => {
    await startUiServer(Number(options.port));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
