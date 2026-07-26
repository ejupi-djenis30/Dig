import assert from "node:assert/strict";
import test from "node:test";
import {
  DestinationPolicyError,
  classifyIpAddress,
  resolveDestination,
} from "../src/network-policy.mjs";
import { fetchGopherResource } from "../src/resource.mjs";

test("classifies public, private and IPv4-mapped IPv6 addresses", () => {
  assert.deepEqual(
    classifyIpAddress("93.184.216.34"),
    {
      address: "93.184.216.34",
      family: 4,
      category: "public",
      public: true,
      connectableWithOverride: true,
    },
  );
  assert.equal(classifyIpAddress("10.20.30.40").category, "private");
  assert.equal(classifyIpAddress("::1").category, "loopback");
  assert.deepEqual(
    classifyIpAddress("::ffff:192.168.1.10"),
    classifyIpAddress("192.168.1.10"),
  );
  assert.equal(classifyIpAddress("2001:db8::1").category, "documentation");
  assert.equal(classifyIpAddress("2606:2800:220:1:248:1893:25c8:1946").public, true);
});

test("hosted resolution rejects every answer set containing a non-public address", async () => {
  const lookup = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ];
  await assert.rejects(
    resolveDestination("example.test", { mode: "hosted", lookup }),
    (error) =>
      error instanceof DestinationPolicyError &&
      error.code === "DESTINATION_BLOCKED" &&
      /loopback/u.test(error.message),
  );
});

test("local resolution requires an explicit override for private destinations", async () => {
  await assert.rejects(
    resolveDestination("127.0.0.1", { mode: "local" }),
    /non-public address/u,
  );
  assert.deepEqual(
    await resolveDestination("127.0.0.1", {
      mode: "local",
      allowPrivate: true,
    }),
    {
      address: "127.0.0.1",
      family: 4,
      category: "loopback",
      resolvedCount: 1,
    },
  );
  await assert.rejects(
    resolveDestination("127.0.0.1", {
      mode: "hosted",
      allowPrivate: true,
    }),
    /Hosted mode cannot allow private destinations/u,
  );
});

test("resource fetching connects to the validated IP instead of resolving again", async () => {
  let transportOptions;
  const result = await fetchGopherResource("gopher://example.test/0/readme", {
    mode: "hosted",
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetcher: async (_address, options) => {
      transportOptions = options;
      return Buffer.from("Pinned connection\r\n.\r\n");
    },
  });

  assert.equal(transportOptions.connectAddress, "93.184.216.34");
  assert.equal(transportOptions.connectFamily, 4);
  assert.equal(result.kind, "text");
  assert.equal(result.text, "Pinned connection");
  assert.equal(result.connection.resolvedCount, 1);
});
