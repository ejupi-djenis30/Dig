import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const serviceWorkerSource = await readFile(new URL("../site/sw.js", import.meta.url), "utf8");

function createRuntime(fetchImplementation, cachedResponse, options = {}) {
  const listeners = new Map();
  const calls = [];
  const cache = {
    async addAll(assets) {
      calls.push({ operation: "addAll", assets: [...assets] });
    },
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
      async delete(key) {
        calls.push({ operation: "delete", key });
        return true;
      },
      async keys() { return options.cacheKeys ?? []; },
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
      clients: {
        async claim() {
          calls.push({ operation: "claim" });
        },
      },
      async skipWaiting() {
        calls.push({ operation: "skipWaiting" });
      },
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

function dispatchExtendable(listener, event = {}) {
  let workPromise;
  listener({
    ...event,
    waitUntil(promise) {
      workPromise = Promise.resolve(promise);
    },
  });
  return workPromise;
}

test("install precaches complete icon assets without activating the update", async () => {
  const { calls, listeners } = createRuntime(async () => new Response("unused"));

  const installWork = dispatchExtendable(listeners.get("install"));
  assert.ok(installWork, "install work must extend the service worker lifetime");
  await installWork;

  const precache = calls.find(({ operation }) => operation === "addAll");
  assert.ok(precache, "install must populate the app-shell cache");
  assert.ok(precache.assets.includes("./assets/dig-mark-180.png"));
  assert.ok(precache.assets.includes("./assets/dig-mark-192.png"));
  assert.ok(precache.assets.includes("./assets/dig-mark-512.png"));
  assert.ok(precache.assets.includes("./assets/dig-mark-maskable.svg"));
  assert.equal(calls.some(({ operation }) => operation === "skipWaiting"), false);
});

test("an explicit SKIP_WAITING message activates the waiting update", async () => {
  const { calls, listeners } = createRuntime(async () => new Response("unused"));
  const messageListener = listeners.get("message");
  const trustedSender = {
    origin: "https://ejupi-djenis30.github.io",
    source: { url: "https://ejupi-djenis30.github.io/Dig/" },
  };

  const ignoredWork = dispatchExtendable(messageListener, {
    ...trustedSender,
    data: { type: "PING" },
  });
  assert.equal(ignoredWork, undefined);
  assert.equal(calls.some(({ operation }) => operation === "skipWaiting"), false);

  const crossOriginWork = dispatchExtendable(messageListener, {
    data: { type: "SKIP_WAITING" },
    origin: "https://attacker.example",
    source: { url: "https://attacker.example/" },
  });
  assert.equal(crossOriginWork, undefined);
  assert.equal(calls.some(({ operation }) => operation === "skipWaiting"), false);

  const updateWork = dispatchExtendable(messageListener, {
    ...trustedSender,
    data: { type: "SKIP_WAITING" },
  });
  assert.ok(updateWork, "the activation request must extend the service worker lifetime");
  await updateWork;
  assert.deepEqual(calls.map(({ operation }) => operation), ["skipWaiting"]);
});

test("static assets prefer a fresh response and update the offline cache", async () => {
  const freshResponse = new Response("fresh", { status: 200 });
  Object.defineProperty(freshResponse, "type", { value: "basic" });
  const { calls, listeners } = createRuntime(async () => freshResponse);

  const response = await dispatchFetch(
    listeners.get("fetch"),
    "https://ejupi-djenis30.github.io/Dig/styles.css?v=3.2.1",
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
    "https://ejupi-djenis30.github.io/Dig/styles.css?v=3.2.1",
  );

  assert.equal(await response.text(), "cached");
  assert.deepEqual(calls.map(({ operation }) => operation), ["fetch", "match"]);
});

test("static assets fall back to cache when the network returns a 5xx response", async () => {
  const { calls, listeners } = createRuntime(
    async () => new Response("upstream failure", { status: 503 }),
    new Response("cached", { status: 200 }),
  );

  const response = await dispatchFetch(
    listeners.get("fetch"),
    "https://ejupi-djenis30.github.io/Dig/styles.css?v=3.2.1",
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
