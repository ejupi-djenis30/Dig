import net from "node:net";
import { parseGopherUrl, selectorRequest } from "../site/protocol.mjs";

export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_BYTES = 1_048_576;

export function fetchGopher(address, options = {}) {
  const { host, port, selector } = parseGopherUrl(address);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const query = options.query ?? "";

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("timeoutMs must be between 1 and 60000.");
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 10_485_760) {
    throw new Error("maxBytes must be between 1 and 10485760.");
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let settled = false;
    const socket = net.createConnection({ host, port });

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => socket.write(selectorRequest(selector, query)));
    socket.on("data", (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        finish(new Error(`Response exceeded the ${maxBytes}-byte limit.`));
        return;
      }
      chunks.push(chunk);
    });
    socket.on("end", () => finish(null, Buffer.concat(chunks).toString("utf8")));
    socket.on("timeout", () => finish(new Error(`Server did not respond within ${timeoutMs} ms.`)));
    socket.on("error", (error) => finish(error));
  });
}
