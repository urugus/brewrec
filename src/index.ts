#!/usr/bin/env node
import { Command } from "commander";
import { compileCommand } from "./commands/compile.js";
import { debugCommand } from "./commands/debug.js";
import { recordCommand } from "./commands/record.js";
import { repairCommand } from "./commands/repair.js";
import { runCommand } from "./commands/run.js";
import { startUiServer } from "./ui/server.js";

const program = new Command();

program.name("browrec").description("Browser record/compile/run CLI").version("0.1.0");

program
  .command("record")
  .argument("<name>", "recording name")
  .option("--url <url>", "start url", "https://example.com")
  .action(async (name: string, options: { url: string }) => {
    await recordCommand(name, options);
  });

program
  .command("compile")
  .argument("<name>", "recording name")
  .option("--llm-command <cmd>", "local llm command", "claude")
  .action(async (name: string, options: { llmCommand: string }) => {
    await compileCommand(name, options);
  });

program
  .command("run")
  .argument("<name>", "recipe name")
  .option("--json", "json output", false)
  .action(async (name: string, options: { json: boolean }) => {
    await runCommand(name, options);
  });

program
  .command("debug")
  .argument("<name>", "recipe name")
  .action(async (name: string) => {
    await debugCommand(name);
  });

program
  .command("repair")
  .argument("<name>", "recipe name")
  .action(async (name: string) => {
    await repairCommand(name);
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
