import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureServer } from "../scripts/gopher-fixture.mjs";
import { fetchGopherResource } from "../src/resource.mjs";

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
