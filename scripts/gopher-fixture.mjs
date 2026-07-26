import net from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_REQUEST_BYTES = 8_192;
const BINARY_PAYLOAD = Buffer.from([
  0x44, 0x49, 0x47, 0x00, 0x47, 0x4f, 0x50, 0x48, 0x45, 0x52,
]);

function menu(port, lines) {
  return Buffer.from(`${lines.join("\r\n")}\r\n.\r\n`.replaceAll("{PORT}", String(port)));
}

function fixtureResponse(request, port) {
  if (request === "") {
    return menu(port, [
      "iDeterministic fixture\tignored\tinvalid\t0",
      "0Welcome to DIG\t/welcome\t127.0.0.1\t{PORT}",
      "1Protocol archive\t/archive\t127.0.0.1\t{PORT}",
      "7Search the archive\t/search\t127.0.0.1\t{PORT}",
      "9Binary sample\t/sample.bin\t127.0.0.1\t{PORT}",
      "hRFC 1436\tURL:https://www.rfc-editor.org/rfc/rfc1436.html\texample.invalid\t70",
    ]);
  }
  if (request === "/archive") {
    return menu(port, [
      "0Request framing\t/framing\t127.0.0.1\t{PORT}",
      "0Menu anatomy\t/menu-anatomy\t127.0.0.1\t{PORT}",
      "1Back to root\t\t127.0.0.1\t{PORT}",
    ]);
  }
  if (request === "/welcome") {
    return Buffer.from(
      "DIG fixture server\r\n\r\nThis response came from a real TCP socket.\r\n..A dot-stuffed line stays visible.\r\n.\r\n",
    );
  }
  if (request === "/framing") {
    return Buffer.from("A selector ends with CRLF.\r\nThe response ends with a period line.\r\n.\r\n");
  }
  if (request === "/menu-anatomy") {
    return Buffer.from("type, label, selector, host and port\r\n.\r\n");
  }
  if (request === "/sample.bin") return BINARY_PAYLOAD;
  if (request.startsWith("/search\t")) {
    const query = request.slice("/search\t".length);
    return menu(port, [
      `0Search result for ${query}\t/welcome\t127.0.0.1\t{PORT}`,
      "1Back to root\t\t127.0.0.1\t{PORT}",
    ]);
  }
  return menu(port, [
    `3Selector not found: ${request}\tignored\tinvalid\t0`,
  ]);
}

export function createFixtureServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const server = net.createServer((socket) => {
    const chunks = [];
    let received = 0;
    let handled = false;
    socket.setTimeout(2_000, () => socket.destroy());
    socket.on("data", (chunk) => {
      if (handled) return;
      received += chunk.length;
      if (received > MAX_REQUEST_BYTES) {
        socket.destroy();
        return;
      }
      chunks.push(chunk);
      const requestBytes = Buffer.concat(chunks);
      const terminator = requestBytes.indexOf("\r\n");
      if (terminator < 0) return;
      handled = true;
      const request = requestBytes.subarray(0, terminator).toString("utf8");
      const address = server.address();
      if (!address || typeof address === "string") {
        socket.destroy();
        return;
      }
      socket.end(fixtureResponse(request, address.port));
    });
  });
  server.maxConnections = 16;
  return {
    server,
    async listen() {
      await new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(port, host, () => {
          server.off("error", rejectListen);
          resolveListen();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Fixture server did not bind to TCP.");
      }
      return {
        host,
        port: address.port,
        url: `gopher://${host}:${address.port}/1`,
      };
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    },
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const fixture = createFixtureServer({
    host: process.env.DIG_FIXTURE_HOST ?? "127.0.0.1",
    port: Number(process.env.DIG_FIXTURE_PORT ?? 7070),
  });
  const address = await fixture.listen();
  process.stdout.write(`DIG fixture server listening on ${address.url}\n`);
  const shutdown = async () => {
    await fixture.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
