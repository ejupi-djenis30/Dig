#!/usr/bin/env node
import { runCli } from "../src/cli.mjs";

const args = process.argv.slice(2);
if (args.length === 1 && ["--version", "-v"].includes(args[0])) {
  process.stdout.write("DIG 3.0.0\n");
} else {
  process.exitCode = await runCli(args, { version: "3.0.0" });
}
