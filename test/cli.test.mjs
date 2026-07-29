import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.mjs";

function outputStream(isTTY = false) {
  const chunks = [];
  return {
    isTTY,
    chunks,
    write(value) {
      chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
      return true;
    },
    text() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

function textResource(overrides = {}) {
  return {
    schemaVersion: 1,
    address: "gopher://example.org/0/readme",
    kind: "text",
    itemType: "0",
    itemTypeLabel: "Text file",
    byteLength: 12,
    sha256: "a".repeat(64),
    text: "hello\n",
    raw: {
      encoding: "base64",
      data: Buffer.from("hello\r\n.\r\n").toString("base64"),
      sha256: "a".repeat(64),
    },
    ...overrides,
  };
}

test("fetch command renders human output and reports the digest", async () => {
  const stdout = outputStream();
  const stderr = outputStream();
  let receivedOptions;
  const status = await runCli(["gopher://example.org/0/readme"], {
    version: "3.2.0",
    stdout,
    stderr,
    fetchResource: async (_address, options) => {
      receivedOptions = options;
      return textResource();
    },
  });

  assert.equal(status, 0);
  assert.equal(stdout.text(), "hello\n");
  assert.match(stderr.text(), new RegExp(`SHA-256 ${"a".repeat(64)}`));
  assert.equal(receivedOptions.mode, "hosted");
  assert.equal(receivedOptions.allowPrivate, false);
});

test("private access is explicit and visible", async () => {
  const stdout = outputStream();
  const stderr = outputStream();
  let receivedOptions;
  const status = await runCli(
    ["--allow-private", "gopher://127.0.0.1/0/readme"],
    {
      stdout,
      stderr,
      fetchResource: async (_address, options) => {
        receivedOptions = options;
        return textResource();
      },
    },
  );
  assert.equal(status, 0);
  assert.equal(receivedOptions.mode, "local");
  assert.equal(receivedOptions.allowPrivate, true);
  assert.match(stderr.text(), /WARNING: private and loopback/u);
});

test("output publication is complete and refuses overwrite unless forced", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dig-cli-"));
  const target = join(directory, "response.txt");
  const stdout = outputStream();
  const stderr = outputStream();
  const options = {
    stdout,
    stderr,
    fetchResource: async () => textResource(),
  };
  try {
    assert.equal(
      await runCli(
        ["--output", target, "gopher://example.org/0/readme"],
        options,
      ),
      0,
    );
    assert.equal(await readFile(target, "utf8"), "hello\r\n.\r\n");

    stderr.chunks.length = 0;
    assert.equal(
      await runCli(
        ["--output", target, "gopher://example.org/0/readme"],
        options,
      ),
      1,
    );
    assert.match(stderr.text(), /Refusing to overwrite/u);

    await writeFile(target, "old");
    assert.equal(
      await runCli(
        ["--force", "--output", target, "gopher://example.org/0/readme"],
        options,
      ),
      0,
    );
    assert.equal(await readFile(target, "utf8"), "hello\r\n.\r\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("serve waits for shutdown and passes an access token without printing it", async () => {
  const stdout = outputStream();
  const stderr = outputStream();
  const processEvents = new EventEmitter();
  let receivedOptions;
  let closed = false;
  const running = runCli(["serve", "--hosted"], {
    stdout,
    stderr,
    env: { DIG_ACCESS_TOKEN: "a-secure-test-token-32-bytes" },
    process: processEvents,
    createServer: async (options) => {
      receivedOptions = options;
      return {
        host: "127.0.0.1",
        port: 4175,
        async listen() {
          return { address: "127.0.0.1", family: "IPv4", port: 4175 };
        },
        async close() {
          closed = true;
        },
      };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  processEvents.emit("SIGTERM");

  assert.equal(await running, 0);
  assert.equal(receivedOptions.mode, "hosted");
  assert.equal(
    receivedOptions.accessToken,
    "a-secure-test-token-32-bytes",
  );
  assert.equal(closed, true);
  assert.doesNotMatch(
    `${stdout.text()}${stderr.text()}`,
    /a-secure-test-token/u,
  );
});

test("raw and byte-output modes reject external web links explicitly", async () => {
  const external = {
    schemaVersion: 1,
    address:
      "gopher://example.org/hURL%3Ahttps%3A%2F%2Fexample.com%2F",
    kind: "external",
    itemType: "h",
    itemTypeLabel: "HTML link",
    target: {
      host: "example.org",
      port: 70,
      type: "h",
      selector: "URL:https://example.com/",
      query: null,
    },
    externalUrl: "https://example.com/",
    byteLength: 0,
    sha256: null,
    durationMs: 0,
  };
  for (const mode of ["--raw", "--output"]) {
    const stdout = outputStream();
    const stderr = outputStream();
    let wroteFile = false;
    const args =
      mode === "--output"
        ? [mode, "external.bin", external.address]
        : [mode, external.address];
    const status = await runCli(args, {
      stdout,
      stderr,
      fetchResource: async () => external,
      writeFileAtomic: async () => {
        wroteFile = true;
      },
    });
    assert.equal(status, 1);
    assert.match(
      stderr.text(),
      /External link items have no Gopher response bytes/u,
    );
    assert.equal(wroteFile, false);
  }
});
