#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fetchGopher } from "../src/client.mjs";
import { safeTerminalText } from "../src/output.mjs";
import {
  decodeTextResponse,
  itemType,
  parseGopherUrl,
  parseMenu,
  toGopherUrl,
} from "../site/protocol.mjs";

const BINARY_TYPES = new Set(["4", "5", "6", "9", "g", "I"]);
const HELP = `DIG — a bounded Gopher protocol client

Usage:
  dig-gopher [options] <gopher://address>

Options:
  --timeout <ms>     Total request deadline (default: 5000)
  --max-bytes <n>    Response limit (default: 1048576)
  --raw              Write the response without menu or text decoding
  -h, --help         Show this help
  -v, --version      Show the version

Binary items are written only when stdout is redirected. Gopher is plaintext;
use only servers you trust and are authorized to reach.
`;

function integerOption(value, name) {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value)) throw new Error(`${name} must be a positive integer.`);
  return Number(value);
}

function writeText(value) {
  process.stdout.write(process.stdout.isTTY ? safeTerminalText(value) : value);
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      timeout: { type: "string" },
      "max-bytes": { type: "string" },
      raw: { type: "boolean" },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
  } else if (values.version) {
    process.stdout.write("DIG 2.1.2\n");
  } else {
    if (positionals.length !== 1) {
      throw new Error("Provide exactly one gopher:// address. Run with --help for examples.");
    }
    const address = positionals[0];
    const target = parseGopherUrl(address);
    const binary = BINARY_TYPES.has(target.type);
    if (binary && process.stdout.isTTY) {
      throw new Error("Refusing to print binary data to a terminal. Redirect stdout to a file.");
    }

    process.stderr.write(
      `DIG / ${safeTerminalText(target.host)}:${target.port} / ${target.type}${safeTerminalText(target.selector)}\n\n`,
    );
    const payload = await fetchGopher(address, {
      encoding: binary ? null : "utf8",
      timeoutMs: integerOption(values.timeout, "--timeout"),
      maxBytes: integerOption(values["max-bytes"], "--max-bytes"),
    });

    if (Buffer.isBuffer(payload)) {
      process.stdout.write(payload);
    } else if (values.raw) {
      writeText(payload);
    } else if (target.type === "1" || target.type === "7") {
      for (const entry of parseMenu(payload)) {
        const kind = itemType(entry.type);
        let destination = "invalid menu line";
        if (entry.valid) {
          destination = toGopherUrl({
            host: entry.host,
            port: entry.port,
            type: entry.type,
            selector: entry.selector,
          });
        }
        writeText(
          `${kind.icon.padEnd(3)}  ${safeTerminalText(entry.label)}\n     ${safeTerminalText(destination)}\n`,
        );
      }
    } else if (target.type === "0") {
      writeText(decodeTextResponse(payload));
    } else {
      writeText(payload);
    }
  }
} catch (error) {
  process.stderr.write(`DIG could not complete the request: ${safeTerminalText(error.message)}\n`);
  process.exitCode = 1;
}
