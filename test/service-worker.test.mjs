import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const serviceWorkerSource = await readFile(new URL("../site/sw.js", import.meta.url), "utf8");

function createRuntime(fetchImplementation, cachedResponse, options = {}) {
  const listeners = new Map();
  const calls = [];
  const cache = {
    async addAll() {},
    async put(request, response) {
      calls.push({ operation: "put", request: String(request), response: await response.text() });
    },
  };
  const context = {
    URL,
    Response,
    fetch: async (request) => {
      calls.push({ operation: "fetch", request: request.url });
      return fetchImplementation(request);
    },
    caches: {
      async delete() { return true; },
      async keys() { return []; },
      async match(request) {
        calls.push({ operation: "match", request: String(request) });
        return cachedResponse?.clone();
      },
      async open() { return cache; },
    },
    self: {
      location: { origin: "https://ejupi-djenis30.github.io" },
      registration: {
        scope:
          options.scope ??
          "https://ejupi-djenis30.github.io/Dig/",
      },
      clients: { async claim() {} },
      async skipWaiting() {},
      addEventListener(type, listener) { listeners.set(type, listener); },
    },
  };
  vm.runInNewContext(serviceWorkerSource, context, { filename: "site/sw.js" });
  return { calls, listeners };
}

function dispatchFetch(listener, url) {
  let responsePromise;
  listener({
    request: {
      headers: { has: () => false },
      method: "GET",
      mode: "cors",
      url,
    },
    respondWith(promise) { responsePromise = promise; },
  });
  assert.ok(responsePromise, "the service worker must handle same-origin static assets");
  return responsePromise;
}

function dispatchIgnoredFetch(listener, url) {
  let handled = false;
  listener({
    request: {
      headers: { has: () => false },
      method: "GET",
      mode: "cors",
      url,
    },
    respondWith() {
      handled = true;
    },
  });
  return handled;
}

test("static assets prefer a fresh response and update the offline cache", async () => {
  const freshResponse = new Response("fresh", { status: 200 });
  Object.defineProperty(freshResponse, "type", { value: "basic" });
  const { calls, listeners } = createRuntime(async () => freshResponse);

  const response = await dispatchFetch(
    listeners.get("fetch"),
    "https://ejupi-djenis30.github.io/Dig/styles.css?v=3.0.0",
  );

  assert.equal(await response.text(), "fresh");
  assert.deepEqual(calls.map(({ operation }) => operation), ["fetch", "put"]);
});

test("static assets fall back to the verified cache when the network is unavailable", async () => {
  const { calls, listeners } = createRuntime(
    async () => { throw new Error("offline"); },
    new Response("cached", { status: 200 }),
  );

  const response = await dispatchFetch(
    listeners.get("fetch"),
    "https://ejupi-djenis30.github.io/Dig/styles.css?v=3.0.0",
  );

  assert.equal(await response.text(), "cached");
  assert.deepEqual(calls.map(({ operation }) => operation), ["fetch", "match"]);
});

test("API responses are never handled or stored by the service worker", () => {
  const { calls, listeners } = createRuntime(async () => new Response("{}"));
  const handled = dispatchIgnoredFetch(
    listeners.get("fetch"),
    "https://ejupi-djenis30.github.io/Dig/api/config",
  );
  assert.equal(handled, false);
  assert.deepEqual(calls, []);
});

test("API exclusion follows the registered deployment scope", () => {
  const { calls, listeners } = createRuntime(
    async () => new Response("{}"),
    undefined,
    {
      scope:
        "https://ejupi-djenis30.github.io/tools/gopher/",
    },
  );
  const handled = dispatchIgnoredFetch(
    listeners.get("fetch"),
    "https://ejupi-djenis30.github.io/tools/gopher/api/config",
  );
  assert.equal(handled, false);
  assert.deepEqual(calls, []);
});
