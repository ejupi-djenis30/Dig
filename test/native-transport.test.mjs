import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createNativeTransport } from "../mobile/native-transport.mjs";

function config() {
  return {
    schemaVersion: 1,
    mode: "android",
    requiresAccessToken: false,
    allowPrivate: false,
    privateDestinationWarning: "Private destinations are blocked.",
    limits: {
      requestBytes: 8192,
      responseBytes: 1_048_576,
      timeoutMs: 10_000,
      idleTimeoutMs: 2_000,
    },
    homeAddress: "gopher://example.com/1/",
    version: "3.2.0",
  };
}

function nativeResponse(text) {
  const bytes = Buffer.from(text);
  return {
    data: bytes.toString("base64"),
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    durationMs: 12.4,
    connection: {
      family: 4,
      address: "93.184.216.34",
      policy: "public",
      resolvedCount: 2,
    },
  };
}

test("native transport maps a raw Gopher menu to the web resource contract", async () => {
  let request;
  const transport = createNativeTransport({
    async getConfig() {
      return config();
    },
    async fetch(options) {
      request = options;
      return nativeResponse(
        "1Directory\t/docs\texample.com\t70\r\n" +
          "0Read me\t/readme.txt\texample.com\t70\r\n.\r\n",
      );
    },
    async cancel() {},
    async save() {
      return { saved: true };
    },
  });

  assert.deepEqual(await transport.getConfig(), config());
  const resource = await transport.fetchResource({
    address: "gopher://example.com/1/",
    includeRaw: true,
  });

  assert.equal(request.host, "example.com");
  assert.equal(request.port, 70);
  assert.equal(request.selector, "/");
  assert.equal(request.itemType, "1");
  assert.equal(resource.kind, "menu");
  assert.equal(resource.entries.length, 2);
  assert.equal(resource.entries[0].url, "gopher://example.com/1/docs");
  assert.equal(resource.entries[1].url, "gopher://example.com/0/readme.txt");
  assert.equal(resource.connection.resolvedCount, 2);
  assert.equal(resource.raw.sha256, resource.sha256);
  assert.deepEqual(
    await transport.saveFile({
      data: resource.raw.data,
      mediaType: "application/octet-stream",
      suggestedFilename: "menu.bin",
    }),
    { saved: true },
  );
});

test("native transport sends search queries and rejects malformed metadata", async () => {
  let request;
  const plugin = {
    async getConfig() {
      return config();
    },
    async fetch(options) {
      request = options;
      return { ...nativeResponse("iNo matches\tfake\tinvalid\t1\r\n.\r\n"), byteLength: 999 };
    },
    async cancel() {},
    async save() {
      return { saved: true };
    },
  };
  const transport = createNativeTransport(plugin);

  await assert.rejects(
    transport.fetchResource({
      address: "gopher://example.com/7/search",
      query: "small web",
    }),
    (error) => error.code === "NATIVE_RESPONSE_INVALID",
  );
  assert.equal(request.query, "small web");
});

test("aborting a native request cancels the matching plugin call", async () => {
  let activeRequestId;
  let cancelledRequestId;
  const plugin = {
    async getConfig() {
      return config();
    },
    fetch(options) {
      activeRequestId = options.requestId;
      return new Promise(() => {});
    },
    async cancel({ requestId }) {
      cancelledRequestId = requestId;
    },
    async save() {
      return { saved: true };
    },
  };
  const transport = createNativeTransport(plugin);
  const controller = new AbortController();
  const pending = transport.fetchResource({
    address: "gopher://example.com/0/readme.txt",
    signal: controller.signal,
  });

  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(cancelledRequestId, activeRequestId);
});
