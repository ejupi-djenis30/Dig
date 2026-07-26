import { Buffer } from "node:buffer";
import { parseArgs } from "node:util";
import { writeFileAtomic } from "./atomic-output.mjs";
import { createDigServer } from "./http-server.mjs";
import { safeTerminalText } from "./output.mjs";
import { fetchGopherResource } from "./resource.mjs";

const FETCH_HELP = `DIG — a bounded Gopher client and local explorer

Usage:
  dig-gopher [options] <gopher://address>
  dig-gopher serve [options]

Fetch options:
  --query <text>       Query for item type 7
  --timeout <ms>       Total deadline (default: 5000)
  --idle-timeout <ms>  Socket idle limit (default: 2000)
  --max-bytes <n>      Response limit (default: 1048576)
  --raw                Write the exact response bytes
  --json               Write the structured response model
  --output <path>      Atomically save exact bytes (JSON with --json)
  --force              Allow --output to replace an existing file
  --allow-private      Permit private/loopback targets for this local command
  -h, --help           Show this help
  -v, --version        Show the version

Private targets are blocked unless --allow-private is explicit. Binary data is
never written to an interactive terminal. Every successful fetch reports its
byte count and SHA-256 digest on stderr. External web-link items have no raw
Gopher bytes; print their URL or use --json instead.
`;

const SERVE_HELP = `DIG local explorer server

Usage:
  dig-gopher serve [options]

Options:
  --host <address>     HTTP bind address (default: 127.0.0.1)
  --port <number>      HTTP port (default: 4175)
  --allow-private      Permit private/loopback Gopher destinations
  --hosted             Enforce public destinations and token authentication
  --origin <url>       Exact browser origin accepted by the fetch API
  --timeout <ms>       Per-fetch total deadline
  --idle-timeout <ms>  Per-fetch socket idle limit
  --max-bytes <n>      Per-fetch response limit
  -h, --help           Show this help

Hosted mode requires DIG_ACCESS_TOKEN (at least 16 bytes). Supplying that
environment variable also protects a non-loopback local bind.
`;

const BINARY_KINDS = new Set(["binary"]);

function integerOption(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${name} is outside its supported range.`);
  }
  return parsed;
}

function outputText(stream, value) {
  stream.write(stream.isTTY ? safeTerminalText(value) : value);
}

function rawBytes(resource) {
  if (resource.kind === "binary") {
    return Buffer.from(resource.data, "base64");
  }
  if (resource.raw?.encoding === "base64") {
    return Buffer.from(resource.raw.data, "base64");
  }
  throw new Error("The exact response bytes are not available.");
}

function renderResource(resource, stdout) {
  if (resource.kind === "menu") {
    for (const entry of resource.entries) {
      const destination =
        entry.url ?? entry.externalUrl ?? "not requestable";
      outputText(
        stdout,
        `${entry.icon.padEnd(3)}  ${entry.label}\n     ${destination}\n`,
      );
    }
    return;
  }
  if (resource.kind === "text") {
    outputText(stdout, resource.text);
    return;
  }
  if (resource.kind === "external") {
    outputText(stdout, `${resource.externalUrl}\n`);
    return;
  }
  if (resource.kind === "binary") {
    stdout.write(rawBytes(resource));
  }
}

async function runFetch(args, runtime) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      query: { type: "string" },
      timeout: { type: "string" },
      "idle-timeout": { type: "string" },
      "max-bytes": { type: "string" },
      raw: { type: "boolean" },
      json: { type: "boolean" },
      output: { type: "string" },
      force: { type: "boolean" },
      "allow-private": { type: "boolean" },
    },
  });
  if (values.help) {
    runtime.stdout.write(FETCH_HELP);
    return 0;
  }
  if (values.version) {
    runtime.stdout.write(`DIG ${runtime.version}\n`);
    return 0;
  }
  if (positionals.length !== 1) {
    throw new Error(
      "Provide exactly one gopher:// address. Run with --help for examples.",
    );
  }
  if (values.raw && values.json) {
    throw new Error("--raw and --json cannot be used together.");
  }
  if (values.force && !values.output) {
    throw new Error("--force requires --output.");
  }
  if (values["allow-private"]) {
    runtime.stderr.write(
      "WARNING: private and loopback destinations are enabled for this command.\n",
    );
  }

  const resource = await runtime.fetchResource(positionals[0], {
    mode: values["allow-private"] ? "local" : "hosted",
    allowPrivate: values["allow-private"] === true,
    includeRaw:
      values.raw === true ||
      (Boolean(values.output) && values.json !== true),
    ...(values.query === undefined ? {} : { query: values.query }),
    timeoutMs: integerOption(values.timeout, "--timeout", 60_000),
    idleTimeoutMs: integerOption(
      values["idle-timeout"],
      "--idle-timeout",
      60_000,
    ),
    maxBytes: integerOption(
      values["max-bytes"],
      "--max-bytes",
      10 * 1024 * 1024,
    ),
  });
  if (
    resource.kind === "external" &&
    (values.raw === true || (Boolean(values.output) && values.json !== true))
  ) {
    throw new Error(
      "External link items have no Gopher response bytes. Run without --raw or use --json.",
    );
  }

  const exact =
    values.json === true
      ? Buffer.from(`${JSON.stringify(resource, null, 2)}\n`)
      : BINARY_KINDS.has(resource.kind) ||
          values.raw === true ||
          Boolean(values.output)
        ? rawBytes(resource)
        : null;
  if (values.output) {
    const target = await runtime.writeFileAtomic(values.output, exact, {
      force: values.force === true,
    });
    runtime.stderr.write(`Saved ${exact.length} bytes to ${target}\n`);
  } else if (values.json) {
    runtime.stdout.write(exact);
  } else if (values.raw) {
    if (resource.kind === "binary" && runtime.stdout.isTTY) {
      throw new Error(
        "Refusing to print binary data to a terminal. Use --output.",
      );
    }
    runtime.stdout.write(exact);
  } else {
    if (resource.kind === "binary" && runtime.stdout.isTTY) {
      throw new Error(
        "Refusing to print binary data to a terminal. Use --output.",
      );
    }
    renderResource(resource, runtime.stdout);
  }
  runtime.stderr.write(
    `SHA-256 ${resource.sha256 ?? "not-applicable"} / ${resource.byteLength} bytes\n`,
  );
  return 0;
}

async function runServe(args, runtime) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      host: { type: "string" },
      port: { type: "string" },
      hosted: { type: "boolean" },
      origin: { type: "string" },
      timeout: { type: "string" },
      "idle-timeout": { type: "string" },
      "max-bytes": { type: "string" },
      "allow-private": { type: "boolean" },
    },
  });
  if (values.help) {
    runtime.stdout.write(SERVE_HELP);
    return 0;
  }
  if (positionals.length > 0) {
    throw new Error("The serve command does not accept positional arguments.");
  }
  const mode = values.hosted ? "hosted" : "local";
  if (mode === "hosted" && values["allow-private"]) {
    throw new Error("--hosted and --allow-private cannot be used together.");
  }
  if (values["allow-private"]) {
    runtime.stderr.write(
      "WARNING: this local server can reach private and loopback Gopher destinations.\n",
    );
  }
  const app = await runtime.createServer({
    host: values.host ?? "127.0.0.1",
    port: integerOption(values.port, "--port", 65_535) ?? 4_175,
    mode,
    allowPrivate: values["allow-private"] === true,
    accessToken: runtime.env.DIG_ACCESS_TOKEN,
    origin: values.origin ?? runtime.env.DIG_ORIGIN,
    timeoutMs: integerOption(values.timeout, "--timeout", 60_000),
    idleTimeoutMs: integerOption(
      values["idle-timeout"],
      "--idle-timeout",
      60_000,
    ),
    maxBytes: integerOption(
      values["max-bytes"],
      "--max-bytes",
      10 * 1024 * 1024,
    ),
  });
  const address = await app.listen();
  const boundPort =
    address && typeof address !== "string" ? address.port : app.port;
  runtime.stdout.write(
    `DIG explorer listening on http://${app.host}:${boundPort}/Dig/\n`,
  );
  await new Promise((resolveShutdown, rejectShutdown) => {
    const shutdown = async () => {
      runtime.process.removeListener("SIGINT", shutdown);
      runtime.process.removeListener("SIGTERM", shutdown);
      try {
        await app.close();
        resolveShutdown();
      } catch (error) {
        rejectShutdown(error);
      }
    };
    runtime.process.once("SIGINT", shutdown);
    runtime.process.once("SIGTERM", shutdown);
  });
  return 0;
}

export async function runCli(args, options = {}) {
  const runtime = {
    version: options.version ?? "0.0.0",
    env: options.env ?? process.env,
    process: options.process ?? process,
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
    fetchResource: options.fetchResource ?? fetchGopherResource,
    createServer: options.createServer ?? createDigServer,
    writeFileAtomic: options.writeFileAtomic ?? writeFileAtomic,
  };
  try {
    return args[0] === "serve"
      ? await runServe(args.slice(1), runtime)
      : await runFetch(args, runtime);
  } catch (error) {
    runtime.stderr.write(
      `DIG could not complete the request: ${safeTerminalText(error.message)}\n`,
    );
    return 1;
  }
}

export { FETCH_HELP, SERVE_HELP };
