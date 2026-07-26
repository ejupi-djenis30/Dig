import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { createFixtureServer } from "../scripts/gopher-fixture.mjs";
import {
  createDigServer,
  createRateLimiter,
} from "../src/http-server.mjs";

const TEST_ACCESS_TOKEN = "test-access-token-32-bytes-long";

async function requestWithHost(origin, host) {
  const target = new URL("/Dig/api/config", origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        headers: { host },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function startHttpApp(options) {
  const app = await createDigServer({
    host: "127.0.0.1",
    port: 0,
    rateLimit: 1_000,
    ...options,
  });
  const address = await app.listen();
  if (!address || typeof address === "string") {
    throw new Error("HTTP test server did not bind.");
  }
  return {
    app,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

test("local API serves config and fetches a real fixture menu", async (context) => {
  const fixture = createFixtureServer();
  const fixtureAddress = await fixture.listen();
  context.after(() => fixture.close());
  const { app, origin } = await startHttpApp({
    mode: "local",
    allowPrivate: true,
    homeAddress: fixtureAddress.url,
    timeoutMs: 1_000,
    idleTimeoutMs: 500,
  });
  context.after(() => app.close());

  const configResponse = await fetch(`${origin}/Dig/api/config`);
  assert.equal(configResponse.status, 200);
  assert.equal(configResponse.headers.get("access-control-allow-origin"), null);
  const config = await configResponse.json();
  assert.equal(config.allowPrivate, true);
  assert.match(config.privateDestinationWarning, /loopback/u);
  assert.equal(config.homeAddress, fixtureAddress.url);

  const response = await fetch(`${origin}/Dig/api/fetch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({ address: fixtureAddress.url }),
  });
  assert.equal(response.status, 200);
  const resource = await response.json();
  assert.equal(resource.kind, "menu");
  assert.equal(resource.connection.address, "127.0.0.1");
  assert.equal(resource.entries.length, 6);
});

test("HTTP API authenticates hosted requests, blocks cross-origin requests and private targets", async (context) => {
  const { app, origin } = await startHttpApp({
    mode: "hosted",
    accessToken: TEST_ACCESS_TOKEN,
  });
  context.after(() => app.close());

  const crossOrigin = await fetch(`${origin}/Dig/api/fetch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
    },
    body: JSON.stringify({ address: "gopher://example.org/1/" }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error.code, "ORIGIN_BLOCKED");

  const unauthenticated = await fetch(`${origin}/Dig/api/fetch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: "gopher://example.org/1/" }),
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal(
    (await unauthenticated.json()).error.code,
    "AUTH_REQUIRED",
  );

  const blocked = await fetch(`${origin}/Dig/api/fetch`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TEST_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ address: "gopher://127.0.0.1/1/" }),
  });
  assert.equal(blocked.status, 403);
  const body = await blocked.json();
  assert.equal(body.error.code, "DESTINATION_BLOCKED");
  assert.equal("stack" in body.error, false);
});

test("HTTP API enforces a strict JSON body limit", async (context) => {
  const { app, origin } = await startHttpApp({
    mode: "hosted",
    accessToken: TEST_ACCESS_TOKEN,
    bodyLimit: 128,
  });
  context.after(() => app.close());
  const response = await fetch(`${origin}/Dig/api/fetch`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TEST_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      address: `gopher://example.org/0/${"a".repeat(200)}`,
    }),
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "BODY_TOO_LARGE");
});

test("hosted mode refuses to start without a strong access token", async () => {
  await assert.rejects(
    createDigServer({ mode: "hosted", port: 0 }),
    /requires an access token/u,
  );
});

test("HTTP Host allowlist blocks DNS-rebinding and host-poisoning requests", async (context) => {
  const { app, origin } = await startHttpApp({ mode: "local" });
  context.after(() => app.close());
  const response = await requestWithHost(origin, "attacker.example");
  assert.equal(response.status, 421);
  assert.equal(JSON.parse(response.body).error.code, "HOST_BLOCKED");
});

test("client disconnect aborts the Gopher fetch and releases its concurrency slot", async (context) => {
  let calls = 0;
  let enterFirstFetch;
  let observeAbort;
  const firstFetchEntered = new Promise((resolve) => {
    enterFirstFetch = resolve;
  });
  const firstFetchAborted = new Promise((resolve) => {
    observeAbort = resolve;
  });
  const fetchResource = async (address, { signal }) => {
    calls += 1;
    if (calls === 1) {
      enterFirstFetch();
      return new Promise((_resolve, reject) => {
        const abort = () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          observeAbort();
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    }
    return {
      schemaVersion: 1,
      address,
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
  };
  const { app, origin } = await startHttpApp({
    mode: "local",
    maxConcurrent: 1,
    fetchResource,
  });
  context.after(() => app.close());

  const target = new URL("/Dig/api/fetch", origin);
  const request = httpRequest({
    hostname: target.hostname,
    port: target.port,
    path: target.pathname,
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  request.on("error", () => {});
  request.end(
    JSON.stringify({ address: "gopher://example.org/1/" }),
  );
  await firstFetchEntered;
  request.destroy();
  await firstFetchAborted;
  await new Promise((resolve) => setImmediate(resolve));

  const second = await fetch(`${origin}/Dig/api/fetch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address:
        "gopher://example.org/hURL%3Ahttps%3A%2F%2Fexample.com%2F",
    }),
  });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).kind, "external");
  assert.equal(calls, 2);
});

test("non-loopback listeners require an exact browser origin", async () => {
  await assert.rejects(
    createDigServer({
      host: "0.0.0.0",
      port: 0,
      mode: "hosted",
      accessToken: TEST_ACCESS_TOKEN,
    }),
    /requires an exact browser origin/u,
  );
});

test("rate limiter caps unique client state before inserting new keys", () => {
  const allow = createRateLimiter(1, 60_000, 2);
  assert.equal(allow("client-a", 1), true);
  assert.equal(allow("client-b", 1), true);
  assert.equal(allow("client-c", 1), true);
  assert.equal(
    allow("client-a", 2),
    true,
    "the oldest key should have been evicted before the third insert",
  );
});
