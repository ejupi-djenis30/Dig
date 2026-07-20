import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { fetchGopher, timeoutMessage } from "../src/client.mjs";

test("requests a selector and returns a bounded response", async (context) => {
  const server = net.createServer((socket) => {
    socket.once("data", (request) => {
      assert.equal(request.toString(), "/demo\r\n");
      socket.end("0Hello\t/hello\t127.0.0.1\t70\r\n.\r\n");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const { port } = server.address();

  const response = await fetchGopher(`gopher://127.0.0.1:${port}/1/demo`, { timeoutMs: 500 });
  assert.match(response, /Hello/);
});

test("stops oversized responses", async (context) => {
  const server = net.createServer((socket) => socket.end("x".repeat(64)));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const { port } = server.address();

  await assert.rejects(
    fetchGopher(`gopher://127.0.0.1:${port}/0/large`, { maxBytes: 8, timeoutMs: 500 }),
    /exceeded/,
  );
});

test("closes connections that stop responding", async (context) => {
  const server = net.createServer(() => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const { port } = server.address();

  await assert.rejects(
    fetchGopher(`gopher://127.0.0.1:${port}/0/wait`, { timeoutMs: 500, idleTimeoutMs: 50 }),
    /idle for more than 50 ms/,
  );
});

test("enforces a total deadline even when a server drips data", async (context) => {
  const server = net.createServer((socket) => {
    socket.on("error", () => {});
    const interval = setInterval(() => {
      if (!socket.destroyed) socket.write("x");
    }, 15);
    socket.on("close", () => clearInterval(interval));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const { port } = server.address();

  await assert.rejects(
    fetchGopher(`gopher://127.0.0.1:${port}/0/drip`, { timeoutMs: 70, idleTimeoutMs: 500 }),
    /total deadline/,
  );
});

test("classifies delayed socket callbacks against the monotonic total deadline", () => {
  assert.match(timeoutMessage(100, 100, 70, 50), /total deadline/);
  assert.match(timeoutMessage(99.99, 100, 70, 50), /idle for more than 50 ms/);
});

test("sends a search query parsed from the Gopher URL", async (context) => {
  const server = net.createServer((socket) => {
    socket.once("data", (request) => {
      assert.equal(request.toString(), "/find\tprotocol safety\r\n");
      socket.end("0Result\t/result\t127.0.0.1\t70\r\n.\r\n");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const { port } = server.address();

  await fetchGopher(`gopher://127.0.0.1:${port}/7/find%09protocol%20safety`, {
    timeoutMs: 500,
  });
});

test("can return binary responses without UTF-8 decoding", async (context) => {
  const expected = Buffer.from([0xff, 0x00, 0x7f]);
  const server = net.createServer((socket) => socket.end(expected));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const { port } = server.address();

  const response = await fetchGopher(`gopher://127.0.0.1:${port}/9/blob`, {
    encoding: null,
    timeoutMs: 500,
  });
  assert.deepEqual(response, expected);
});

test("supports AbortSignal cancellation", async (context) => {
  const server = net.createServer(() => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const { port } = server.address();
  const controller = new AbortController();
  const request = fetchGopher(`gopher://127.0.0.1:${port}/0/wait`, {
    signal: controller.signal,
    timeoutMs: 500,
  });
  controller.abort();

  await assert.rejects(request, { name: "AbortError" });
});

test("validates AbortSignal-like options before opening a socket", () => {
  assert.throws(
    () => fetchGopher("gopher://127.0.0.1/0/test", { signal: {} }),
    /AbortSignal/,
  );
});
