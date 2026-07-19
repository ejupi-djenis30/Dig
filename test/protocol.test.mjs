import assert from "node:assert/strict";
import test from "node:test";
import { parseGopherUrl, parseMenu, selectorRequest, toGopherUrl } from "../site/protocol.mjs";

test("parses a default-port Gopher URL", () => {
  assert.deepEqual(parseGopherUrl("gopher://example.org/1/archive"), {
    host: "example.org",
    port: 70,
    type: "1",
    selector: "/archive",
  });
});

test("round-trips an item destination", () => {
  const url = toGopherUrl({ host: "example.org", port: 7070, type: "0", selector: "/read me" });
  assert.deepEqual(parseGopherUrl(url), {
    host: "example.org",
    port: 7070,
    type: "0",
    selector: "/read me",
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
  });
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
});
