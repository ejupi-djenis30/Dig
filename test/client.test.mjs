import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { fetchGopher } from "../src/client.mjs";

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
