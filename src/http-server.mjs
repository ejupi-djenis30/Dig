import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DestinationPolicyError } from "./network-policy.mjs";
import { fetchGopherResource } from "./resource.mjs";

const SITE_ROOT = fileURLToPath(new URL("../site/", import.meta.url));
const SITE_PREFIX = SITE_ROOT.endsWith(sep) ? SITE_ROOT : `${SITE_ROOT}${sep}`;
const PACKAGE_PATH = fileURLToPath(new URL("../package.json", import.meta.url));
const PAGE_PATH = "/Dig/";
const API_PATH = `${PAGE_PATH}api/`;
const DEFAULT_BODY_LIMIT = 8_192;
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_RATE_LIMIT = 30;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const MAX_RATE_CLIENTS = 1_000;
const REQUEST_URL_BASE = "http://dig.invalid";
const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

function headers(contentType, extra = {}) {
  return {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    ...extra,
  };
}

function sendJson(response, status, value, options = {}) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(
    status,
    headers("application/json; charset=utf-8", {
      "Content-Length": Buffer.byteLength(body),
    }),
  );
  response.end(options.head === true ? undefined : body);
}

function sendText(response, status, value) {
  const body = `${value}\n`;
  response.writeHead(
    status,
    headers("text/plain; charset=utf-8", {
      "Content-Length": Buffer.byteLength(body),
    }),
  );
  response.end(body);
}

export function createRateLimiter(
  limit,
  windowMs,
  maxClients = MAX_RATE_CLIENTS,
) {
  const clients = new Map();
  return function allow(key, now = Date.now()) {
    const previous = clients.get(key);
    if (previous && now - previous.startedAt < windowMs) {
      previous.count += 1;
      return previous.count <= limit;
    }

    for (const [clientKey, value] of clients) {
      if (now - value.startedAt >= windowMs) clients.delete(clientKey);
    }
    if (!clients.has(key)) {
      while (clients.size >= maxClients) {
        clients.delete(clients.keys().next().value);
      }
    }
    if (!previous || now - previous.startedAt >= windowMs) {
      clients.set(key, { count: 1, startedAt: now });
      return true;
    }
    return false;
  };
}

async function readJsonBody(request, limit) {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw Object.assign(new Error("Request body is too large."), {
      code: "BODY_TOO_LARGE",
    });
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) {
      throw Object.assign(new Error("Request body is too large."), {
        code: "BODY_TOO_LARGE",
      });
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), {
      code: "BODY_INVALID",
    });
  }
}

function requestIsSameOrigin(request, configuredOrigin) {
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    if (configuredOrigin) return new URL(origin).origin === configuredOrigin;
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function requestHostIsAllowed(request, configuredOrigin, loopbackBind) {
  const hostHeader = request.headers.host;
  if (typeof hostHeader !== "string") return false;
  try {
    const hostUrl = new URL(`http://${hostHeader}`);
    if (
      hostUrl.username ||
      hostUrl.password ||
      hostUrl.pathname !== "/" ||
      hostUrl.search ||
      hostUrl.hash
    ) {
      return false;
    }
    if (configuredOrigin) {
      return hostUrl.host === new URL(configuredOrigin).host;
    }
    if (!loopbackBind) return false;
    const hostname = hostUrl.hostname
      .toLowerCase()
      .replace(/^\[|\]$/gu, "");
    const loopbackHost =
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname.startsWith("127.");
    const requestedPort = hostUrl.port
      ? Number(hostUrl.port)
      : hostUrl.protocol === "https:"
        ? 443
        : 80;
    return loopbackHost && requestedPort === request.socket.localPort;
  } catch {
    return false;
  }
}

function requestPathname(request) {
  const rawUrl = request.url;
  if (typeof rawUrl !== "string" || !rawUrl.startsWith("/")) {
    throw Object.assign(new Error("The request target is invalid."), {
      code: "REQUEST_TARGET_INVALID",
    });
  }
  const parsed = new URL(rawUrl, REQUEST_URL_BASE);
  if (parsed.origin !== REQUEST_URL_BASE) {
    throw Object.assign(new Error("The request target is invalid."), {
      code: "REQUEST_TARGET_INVALID",
    });
  }
  return parsed.pathname;
}

function tokenDigest(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

function requestHasAccess(request, expectedDigest) {
  if (!expectedDigest) return true;
  const authorization = request.headers.authorization;
  const supplied =
    typeof authorization === "string" &&
    authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
  return timingSafeEqual(tokenDigest(supplied), expectedDigest);
}

function isLoopbackBind(host) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/gu, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized.startsWith("127.")
  );
}

function publicError(error) {
  if (error instanceof DestinationPolicyError) {
    return { status: 403, code: error.code, message: error.message };
  }
  if (error?.code === "BODY_TOO_LARGE") {
    return { status: 413, code: error.code, message: error.message };
  }
  if (
    error?.code === "BODY_INVALID" ||
    error?.code === "SEARCH_QUERY_REQUIRED" ||
    error?.code === "ADDRESS_INVALID"
  ) {
    return { status: 400, code: error.code, message: error.message };
  }
  if (error?.code === "ITEM_NOT_REQUESTABLE") {
    return { status: 422, code: error.code, message: error.message };
  }
  if (/Response exceeded the \d+-byte limit\./u.test(error?.message ?? "")) {
    return {
      status: 413,
      code: "RESPONSE_TOO_LARGE",
      message: "The Gopher response exceeded the configured byte limit.",
    };
  }
  if (/deadline|idle for more than/iu.test(error?.message ?? "")) {
    return {
      status: 504,
      code: "GOPHER_TIMEOUT",
      message: "The Gopher server did not respond within the configured limits.",
    };
  }
  if (
    typeof error?.code === "string" &&
    /^(?:EAI_|ECONN|EHOST|ENET|ETIMEDOUT|ENOTFOUND)/u.test(error.code)
  ) {
    return {
      status: 502,
      code: "GOPHER_UNREACHABLE",
      message: "The Gopher server could not be reached.",
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "The request could not be completed.",
  };
}

async function serveStatic(request, response, pathname) {
  if (!pathname.startsWith(PAGE_PATH)) {
    sendText(response, 404, "Not found");
    return;
  }
  const pageRelativePath = pathname.slice(PAGE_PATH.length);
  const relativePath = pageRelativePath === "" ? "index.html" : pageRelativePath;
  const filePath = resolve(SITE_ROOT, relativePath);
  if (!filePath.startsWith(SITE_PREFIX)) {
    sendText(response, 403, "Forbidden");
    return;
  }
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) throw new Error("Not a file");
    response.writeHead(
      200,
      headers(CONTENT_TYPES.get(extname(filePath)) ?? "application/octet-stream", {
        "Content-Length": metadata.size,
      }),
    );
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not found");
  }
}

export async function createDigServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4175;
  const mode = options.mode ?? "local";
  const allowPrivate = options.allowPrivate === true;
  const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
  const maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const rateLimit = options.rateLimit ?? DEFAULT_RATE_LIMIT;
  const rateWindowMs = options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS;
  const configuredOrigin = options.origin
    ? new URL(options.origin).origin
    : null;
  const accessToken = options.accessToken;
  const loopbackBind = isLoopbackBind(host);
  if (mode !== "local" && mode !== "hosted") {
    throw new Error('mode must be "local" or "hosted".');
  }
  if (mode === "hosted" && allowPrivate) {
    throw new Error("Hosted mode cannot enable private destinations.");
  }
  if (
    mode === "hosted" &&
    (typeof accessToken !== "string" || Buffer.byteLength(accessToken) < 16)
  ) {
    throw new Error(
      "Hosted mode requires an access token of at least 16 bytes.",
    );
  }
  if (
    accessToken !== undefined &&
    (typeof accessToken !== "string" || Buffer.byteLength(accessToken) < 16)
  ) {
    throw new Error("accessToken must contain at least 16 bytes.");
  }
  if (mode === "local" && !accessToken && !loopbackBind) {
    throw new Error(
      "An unauthenticated local server must bind to a loopback address.",
    );
  }
  if (!loopbackBind && !configuredOrigin) {
    throw new Error(
      "A non-loopback HTTP bind requires an exact browser origin.",
    );
  }
  for (const [name, value, maximum] of [
    ["bodyLimit", bodyLimit, 65_536],
    ["maxConcurrent", maxConcurrent, 64],
    ["rateLimit", rateLimit, 10_000],
    ["rateWindowMs", rateWindowMs, 3_600_000],
  ]) {
    if (!Number.isInteger(value) || value < 1 || value > maximum) {
      throw new Error(`${name} must be between 1 and ${maximum}.`);
    }
  }

  const packageMetadata = JSON.parse(await readFile(PACKAGE_PATH, "utf8"));
  const allowRateRequest = createRateLimiter(rateLimit, rateWindowMs);
  const fetchResource = options.fetchResource ?? fetchGopherResource;
  const expectedAccessDigest = accessToken ? tokenDigest(accessToken) : null;
  let activeFetches = 0;

  const server = createServer(async (request, response) => {
    let pathname;
    try {
      pathname = requestPathname(request);
    } catch {
      sendJson(response, 400, {
        error: {
          code: "REQUEST_TARGET_INVALID",
          message: "The request target is invalid.",
        },
      });
      return;
    }
    if (
      pathname !== "/healthz" &&
      !requestHostIsAllowed(request, configuredOrigin, loopbackBind)
    ) {
      sendJson(response, 421, {
        error: {
          code: "HOST_BLOCKED",
          message: "The HTTP Host header is not accepted by this server.",
        },
      });
      return;
    }

    if (pathname === "/healthz") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendText(response, 405, "Method not allowed");
        return;
      }
      sendJson(
        response,
        200,
        {
          status: "ok",
          mode,
          version: packageMetadata.version,
        },
        { head: request.method === "HEAD" },
      );
      return;
    }

    if (pathname === `${API_PATH}config`) {
      if (request.method !== "GET") {
        sendText(response, 405, "Method not allowed");
        return;
      }
      sendJson(response, 200, {
        schemaVersion: 1,
        mode,
        requiresAccessToken: Boolean(expectedAccessDigest),
        allowPrivate,
        privateDestinationWarning: allowPrivate
          ? "Private and loopback destinations are enabled for this local process."
          : null,
        limits: {
          requestBytes: bodyLimit,
          responseBytes: options.maxBytes ?? 1_048_576,
          timeoutMs: options.timeoutMs ?? 5_000,
          idleTimeoutMs: options.idleTimeoutMs ?? 2_000,
        },
        homeAddress:
          options.homeAddress ?? "gopher://gopher.floodgap.com/1/",
        version: packageMetadata.version,
      });
      return;
    }

    if (pathname === `${API_PATH}fetch`) {
      if (request.method !== "POST") {
        sendText(response, 405, "Method not allowed");
        return;
      }
      if (!requestIsSameOrigin(request, configuredOrigin)) {
        sendJson(response, 403, {
          error: { code: "ORIGIN_BLOCKED", message: "Cross-origin requests are not allowed." },
        });
        return;
      }
      if (!requestHasAccess(request, expectedAccessDigest)) {
        response.setHeader("WWW-Authenticate", 'Bearer realm="DIG"');
        sendJson(response, 401, {
          error: {
            code: "AUTH_REQUIRED",
            message: "A valid access token is required.",
          },
        });
        return;
      }
      if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        sendJson(response, 415, {
          error: { code: "CONTENT_TYPE_INVALID", message: "Use application/json." },
        });
        return;
      }
      const clientKey = request.socket.remoteAddress ?? "unknown";
      if (!allowRateRequest(clientKey)) {
        sendJson(response, 429, {
          error: { code: "RATE_LIMITED", message: "Too many requests. Try again shortly." },
        });
        return;
      }
      if (activeFetches >= maxConcurrent) {
        sendJson(response, 503, {
          error: { code: "CAPACITY_REACHED", message: "The server is handling its maximum number of Gopher requests." },
        });
        return;
      }

      activeFetches += 1;
      const fetchController = new AbortController();
      const abortFetch = () => fetchController.abort();
      const abortOnClosedResponse = () => {
        if (!response.writableEnded) abortFetch();
      };
      request.once("aborted", abortFetch);
      response.once("close", abortOnClosedResponse);
      try {
        const body = await readJsonBody(request, bodyLimit);
        if (
          !body ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          typeof body.address !== "string" ||
          (body.query !== undefined && typeof body.query !== "string") ||
          (body.includeRaw !== undefined &&
            typeof body.includeRaw !== "boolean") ||
          Object.keys(body).some(
            (key) =>
              key !== "address" &&
              key !== "query" &&
              key !== "includeRaw",
          )
        ) {
          throw Object.assign(
            new TypeError("The body must contain an address and an optional query."),
            { code: "BODY_INVALID" },
          );
        }
        const resource = await fetchResource(body.address, {
          mode,
          allowPrivate,
          includeRaw: body.includeRaw === true,
          ...(body.query === undefined ? {} : { query: body.query }),
          timeoutMs: options.timeoutMs,
          idleTimeoutMs: options.idleTimeoutMs,
          maxBytes: options.maxBytes,
          signal: fetchController.signal,
          lookup: options.lookup,
          fetcher: options.fetcher,
        });
        sendJson(response, 200, resource);
      } catch (error) {
        if (!response.destroyed && !response.writableEnded) {
          const exposed = publicError(error);
          sendJson(response, exposed.status, {
            error: { code: exposed.code, message: exposed.message },
          });
        }
      } finally {
        request.off("aborted", abortFetch);
        response.off("close", abortOnClosedResponse);
        activeFetches -= 1;
      }
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(response, 405, "Method not allowed");
      return;
    }
    await serveStatic(request, response, pathname);
  });

  server.requestTimeout = 12_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  return {
    server,
    host,
    port,
    mode,
    allowPrivate,
    async listen() {
      await new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(port, host, () => {
          server.off("error", rejectListen);
          resolveListen();
        });
      });
      return server.address();
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
        server.closeIdleConnections?.();
      });
    },
  };
}
