import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeTextResponse,
  MAX_REQUEST_BYTES,
  parseGopherUrl,
  parseMenu,
  selectorRequest,
  toGopherUrl,
} from "../site/protocol.mjs";

test("parses a default-port Gopher URL", () => {
  assert.deepEqual(parseGopherUrl("gopher://example.org/1/archive"), {
    host: "example.org",
    port: 70,
    type: "1",
    selector: "/archive",
    query: null,
  });
});

test("round-trips an item destination", () => {
  const url = toGopherUrl({ host: "example.org", port: 7070, type: "0", selector: "/read me" });
  assert.deepEqual(parseGopherUrl(url), {
    host: "example.org",
    port: 7070,
    type: "0",
    selector: "/read me",
    query: null,
  });
});

test("round-trips delimiter characters and IPv6 hosts without truncating selectors", () => {
  const url = toGopherUrl({ host: "::1", port: 7070, type: "0", selector: "read?part#one" });

  assert.equal(url, "gopher://[::1]:7070/0read%3Fpart%23one");
  assert.deepEqual(parseGopherUrl(url), {
    host: "::1",
    port: 7070,
    type: "0",
    selector: "read?part#one",
    query: null,
  });
});

test("preserves selector dot-segments instead of applying HTTP path normalization", () => {
  assert.deepEqual(parseGopherUrl("gopher://example.org/1/a/../b"), {
    host: "example.org",
    port: 70,
    type: "1",
    selector: "/a/../b",
    query: null,
  });
});

test("parses and serializes RFC 4266 search URLs", () => {
  const address = toGopherUrl({
    host: "search.example",
    type: "7",
    selector: "/lookup",
    query: "rust gopher",
  });
  assert.equal(address, "gopher://search.example/7/lookup%09rust%20gopher");
  assert.deepEqual(parseGopherUrl(address), {
    host: "search.example",
    port: 70,
    type: "7",
    selector: "/lookup",
    query: "rust gopher",
  });
  assert.equal(selectorRequest("/lookup", "rust gopher"), "/lookup\trust gopher\r\n");
  assert.equal(selectorRequest("/lookup", ""), "/lookup\t\r\n");
});

test("parses valid entries and exposes malformed lines", () => {
  const result = parseMenu("1Archive\t/archive\texample.org\t70\r\nbroken\r\n.\r\n3Ignored\t/error\texample.org\t70\r\n");
  assert.equal(result.length, 2);
  assert.equal(result[0].valid, true);
  assert.equal(result[0].label, "Archive");
  assert.equal(result[1].valid, false);
  assert.match(result[1].label, /Malformed line/);
});

test("rejects non-Gopher URLs and line breaks", () => {
  assert.throws(() => parseGopherUrl("https://example.org"), /only gopher/);
  assert.throws(() => selectorRequest("/safe\r\nmalicious"), /line breaks/);
  assert.throws(() => selectorRequest("/safe", "query\twith-an-extra-field"), /control characters/);
});

test("rejects ambiguous or unsafe URL components", () => {
  assert.throws(() => parseGopherUrl("gopher://user@example.org/1/"), /credentials/);
  assert.throws(() => parseGopherUrl("gopher://example.org/1/read?part"), /Encode question marks/);
  assert.throws(() => parseGopherUrl("gopher://example.org/1/%0a"), /control characters/);
  assert.throws(
    () => toGopherUrl({ host: "example.org@redirect.invalid", selector: "/" }),
    /invalid URL characters/,
  );
  assert.throws(() => toGopherUrl({ host: "example.org", port: 0 }), /between 1 and 65535/);
  assert.throws(() => parseGopherUrl("gopher://example.org/7/find%09term%09+"), /Gopher\+/);
  assert.throws(() => parseGopherUrl(" gopher://example.org/1/"), /whitespace/);
  assert.throws(() => parseGopherUrl("gopher://example.org/é/path"), /visible ASCII/);
  assert.throws(() => parseGopherUrl("gopher://example.org:/1/"), /port must be a number/);
});

test("bounds encoded requests and parsed menu growth", () => {
  assert.throws(() => selectorRequest("é".repeat(MAX_REQUEST_BYTES)), /encoded request/);
  assert.throws(
    () => parseMenu("0One\t/1\texample.org\t70\n0Two\t/2\texample.org\t70\n", { maxEntries: 1 }),
    /entry limit/,
  );
});

test("marks destinations with unsafe authorities as invalid", () => {
  const [entry] = parseMenu("0Trap\t/\tuser@redirect.invalid\t70\r\n.\r\n");
  assert.equal(entry.valid, false);
});

test("removes RFC 1436 text framing and unstuffs leading dots", () => {
  assert.equal(
    decodeTextResponse("First\r\n..foo\r\n...\r\nSecond\r\n.\r\n..ignored"),
    "First\n.foo\n..\nSecond",
  );
});

test("only removes a dot from lines that were dot-stuffed", () => {
  assert.equal(decodeTextResponse("..foo\n.bar\n..."), ".foo\n.bar\n..");
});
