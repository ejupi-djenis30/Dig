import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createFixtureServer } from "../scripts/gopher-fixture.mjs";
import { fetchGopherResource } from "../src/resource.mjs";

test("total deadline bounds DNS resolution even when the resolver never settles", async () => {
  await assert.rejects(fetchGopherResource("gopher://example.org/0/test", {
    timeoutMs: 30,
    lookup: () => new Promise(() => {}),
    fetcher: () => assert.fail("a stalled lookup must not open a connection"),
  }), /30 ms total deadline/u);
});

test("cancelling DNS returns promptly and never connects after its late answer", async () => {
  const controller = new AbortController();
  let finishLookup;
  let fetchCount = 0;
  const request = fetchGopherResource("gopher://example.org/0/test", {
    signal: controller.signal,
    lookup: () => new Promise((resolve) => { finishLookup = resolve; }),
    fetcher: () => { fetchCount += 1; return Buffer.from("late"); },
  });
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
  finishLookup([{ address: "93.184.216.34", family: 4 }]);
  await delay(0);
  assert.equal(fetchCount, 0);
});

test("an already cancelled request performs no DNS work", async () => {
  await assert.rejects(fetchGopherResource("gopher://example.org/0/test", {
    signal: AbortSignal.abort(),
    lookup: () => assert.fail("cancelled requests must not resolve DNS"),
  }), { name: "AbortError" });
});

test("DNS and transport share one deadline and reported duration", async () => {
  const resource = await fetchGopherResource("gopher://example.org/0/test", {
    timeoutMs: 1_000,
    lookup: async () => {
      await delay(30);
      return [{ address: "93.184.216.34", family: 4 }];
    },
    fetcher: async (_address, options) => {
      assert.ok(options.timeoutMs > 0 && options.timeoutMs < 1_000);
      assert.equal(options.connectAddress, "93.184.216.34");
      return Buffer.from("bounded\r\n.\r\n");
    },
  });
  assert.ok(resource.durationMs >= 20, "duration includes time spent resolving DNS");
  assert.equal(resource.text, "bounded");
});

test("fetches menus, text, search results and binary bytes from the TCP fixture", async (context) => {
  const fixture = createFixtureServer();
  const address = await fixture.listen();
  context.after(() => fixture.close());
  const options = {
    mode: "local",
    allowPrivate: true,
    timeoutMs: 1_000,
    idleTimeoutMs: 500,
  };

  const root = await fetchGopherResource(address.url, options);
  assert.equal(root.kind, "menu");
  assert.equal(root.entries.length, 6);
  assert.equal(root.entries.find(({ type }) => type === "0").requestable, true);
  assert.equal(root.entries.find(({ type }) => type === "7").requiresQuery, true);
  assert.equal(
    root.entries.find(({ type }) => type === "h").externalUrl,
    "https://www.rfc-editor.org/rfc/rfc1436.html",
  );

  const text = await fetchGopherResource(
    `gopher://127.0.0.1:${address.port}/0/welcome`,
    options,
  );
  assert.equal(text.kind, "text");
  assert.match(text.text, /real TCP socket/u);
  assert.match(text.text, /\.A dot-stuffed line/u);

  const search = await fetchGopherResource(
    `gopher://127.0.0.1:${address.port}/7/search`,
    { ...options, query: "selectors" },
  );
  assert.equal(search.kind, "menu");
  assert.match(search.entries[0].label, /selectors/u);

  const binary = await fetchGopherResource(
    `gopher://127.0.0.1:${address.port}/9/sample.bin`,
    options,
  );
  assert.equal(binary.kind, "binary");
  assert.equal(binary.encoding, "base64");
  assert.equal(Buffer.from(binary.data, "base64").toString("hex"), "44494700474f50484552");
  assert.equal(binary.mediaType, "application/octet-stream");
  assert.match(binary.sha256, /^[a-f0-9]{64}$/u);
});

test("raw inspection is opt-in for text and menu resources", async (context) => {
  const fixture = createFixtureServer();
  const address = await fixture.listen();
  context.after(() => fixture.close());
  const options = {
    mode: "local",
    allowPrivate: true,
    timeoutMs: 1_000,
    idleTimeoutMs: 500,
  };

  const withoutRaw = await fetchGopherResource(address.url, options);
  assert.equal("raw" in withoutRaw, false);

  const withRaw = await fetchGopherResource(address.url, {
    ...options,
    includeRaw: true,
  });
  assert.equal(withRaw.raw.encoding, "base64");
  assert.equal(withRaw.raw.sha256, withRaw.sha256);
  assert.match(
    Buffer.from(withRaw.raw.data, "base64").toString("utf8"),
    /Deterministic fixture/u,
  );
});

test("does not open interactive services or HTML links through the Gopher transport", async () => {
  await assert.rejects(
    fetchGopherResource("gopher://example.org/8/telnet", {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      fetcher: async () => {
        throw new Error("transport must not run");
      },
    }),
    /not requestable/u,
  );
  const external = await fetchGopherResource(
    "gopher://example.org/hURL%3Ahttps%3A%2F%2Fexample.com%2F",
  );
  assert.equal(external.kind, "external");
  assert.equal(external.externalUrl, "https://example.com/");
});
