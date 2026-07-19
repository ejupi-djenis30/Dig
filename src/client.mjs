import net from "node:net";
import { parseGopherUrl, selectorRequest } from "../site/protocol.mjs";

export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 2_500;
export const DEFAULT_MAX_BYTES = 1_048_576;

function boundedInteger(value, name, maximum) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}.`);
  }
}

function abortError() {
  const error = new Error("The Gopher request was aborted.");
  error.name = "AbortError";
  return error;
}

export function fetchGopher(address, options = {}) {
  const target = parseGopherUrl(address);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? Math.min(DEFAULT_IDLE_TIMEOUT_MS, timeoutMs);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const query = Object.hasOwn(options, "query") ? options.query : target.query;
  const encoding = options.encoding === undefined ? "utf8" : options.encoding;
  const signal = options.signal;

  boundedInteger(timeoutMs, "timeoutMs", 60_000);
  boundedInteger(idleTimeoutMs, "idleTimeoutMs", 60_000);
  boundedInteger(maxBytes, "maxBytes", 10_485_760);
  if (encoding !== "utf8" && encoding !== null) {
    throw new Error('encoding must be "utf8" or null.');
  }
  if (
    signal !== undefined &&
    (signal === null ||
      typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function")
  ) {
    throw new Error("signal must be an AbortSignal.");
  }
  if (signal?.aborted) return Promise.reject(abortError());
  const request = selectorRequest(target.selector, query);

  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let settled = false;
    const socket = net.createConnection({ host: target.host, port: target.port });
    const deadline = setTimeout(
      () => finish(new Error(`Request exceeded the ${timeoutMs} ms total deadline.`)),
      timeoutMs,
    );
    const onAbort = () => finish(abortError());

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      error ? reject(error) : resolve(value);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    socket.setTimeout(idleTimeoutMs);
    socket.on("connect", () => socket.write(request));
    socket.on("data", (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        finish(new Error(`Response exceeded the ${maxBytes}-byte limit.`));
        return;
      }
      chunks.push(chunk);
    });
    socket.on("end", () => {
      const payload = Buffer.concat(chunks);
      finish(null, encoding === null ? payload : payload.toString(encoding));
    });
    socket.on("timeout", () =>
      finish(new Error(`Server was idle for more than ${idleTimeoutMs} ms.`)),
    );
    socket.on("error", (error) => finish(error));
  });
}
