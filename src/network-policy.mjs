import { lookup as defaultLookup } from "node:dns/promises";
import { isIP } from "node:net";

export class DestinationPolicyError extends Error {
  constructor(message, code = "DESTINATION_BLOCKED") {
    super(message);
    this.name = "DestinationPolicyError";
    this.code = code;
  }
}

function parseIpv4(address) {
  if (isIP(address) !== 4) return null;
  const bytes = address.split(".").map(Number);
  return {
    address: bytes.join("."),
    bytes,
    integer:
      (((bytes[0] << 24) >>> 0) |
        (bytes[1] << 16) |
        (bytes[2] << 8) |
        bytes[3]) >>>
      0,
  };
}

function ipv4InRange(integer, base, prefixLength) {
  const mask =
    prefixLength === 0
      ? 0
      : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (integer & mask) === (base & mask);
}

function parseIpv6(address) {
  if (isIP(address) !== 6 || address.includes("%")) return null;
  let source = address.toLowerCase();
  if (source.includes(".")) {
    const separator = source.lastIndexOf(":");
    const ipv4 = parseIpv4(source.slice(separator + 1));
    if (!ipv4) return null;
    source = `${source.slice(0, separator)}:${(
      (ipv4.bytes[0] << 8) |
      ipv4.bytes[1]
    ).toString(16)}:${((ipv4.bytes[2] << 8) | ipv4.bytes[3]).toString(16)}`;
  }

  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const omitted = 8 - left.length - right.length;
  if (
    (halves.length === 1 && omitted !== 0) ||
    (halves.length === 2 && omitted < 1)
  ) {
    return null;
  }
  const groups = [
    ...left,
    ...Array.from({ length: omitted }, () => "0"),
    ...right,
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))
  ) {
    return null;
  }
  const bytes = [];
  for (const group of groups) {
    const value = Number.parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return { address: source, bytes };
}

function ipv6HasPrefix(bytes, prefixBytes, prefixLength) {
  const wholeBytes = Math.floor(prefixLength / 8);
  const remainingBits = prefixLength % 8;
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== prefixBytes[index]) return false;
  }
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (bytes[wholeBytes] & mask) === (prefixBytes[wholeBytes] & mask);
}

function ipv6Prefix(address, prefixLength) {
  const parsed = parseIpv6(address);
  if (!parsed) throw new Error(`Invalid internal IPv6 prefix: ${address}`);
  return { bytes: parsed.bytes, prefixLength };
}

const IPV4_BLOCKS = [
  ["unspecified", "0.0.0.0", 8, false],
  ["private", "10.0.0.0", 8, true],
  ["carrier-grade", "100.64.0.0", 10, true],
  ["loopback", "127.0.0.0", 8, true],
  ["link-local", "169.254.0.0", 16, true],
  ["private", "172.16.0.0", 12, true],
  ["ietf-special", "192.0.0.0", 24, false],
  ["documentation", "192.0.2.0", 24, false],
  ["6to4-relay", "192.88.99.0", 24, false],
  ["private", "192.168.0.0", 16, true],
  ["benchmark", "198.18.0.0", 15, false],
  ["documentation", "198.51.100.0", 24, false],
  ["documentation", "203.0.113.0", 24, false],
  ["multicast", "224.0.0.0", 4, false],
  ["reserved", "240.0.0.0", 4, false],
].map(([category, address, prefixLength, connectableWithOverride]) => ({
  category,
  base: parseIpv4(address).integer,
  prefixLength,
  connectableWithOverride,
}));

const IPV6_BLOCKS = [
  ["teredo", "2001::", 32, false],
  ["benchmark", "2001:2::", 48, false],
  ["orchid", "2001:10::", 28, false],
  ["orchid", "2001:20::", 28, false],
  ["documentation", "2001:db8::", 32, false],
  ["6to4", "2002::", 16, false],
].map(([category, address, prefixLength, connectableWithOverride]) => ({
  category,
  ...ipv6Prefix(address, prefixLength),
  connectableWithOverride,
}));

export function classifyIpAddress(address) {
  const ipv4 = parseIpv4(address);
  if (ipv4) {
    const block = IPV4_BLOCKS.find(({ base, prefixLength }) =>
      ipv4InRange(ipv4.integer, base, prefixLength),
    );
    return {
      address: ipv4.address,
      family: 4,
      category: block?.category ?? "public",
      public: !block,
      connectableWithOverride: block?.connectableWithOverride ?? true,
    };
  }

  const ipv6 = parseIpv6(address);
  if (!ipv6) {
    throw new DestinationPolicyError(
      "The destination did not resolve to a valid IP address.",
      "DESTINATION_INVALID",
    );
  }

  const mappedPrefix = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff,
  ];
  if (
    mappedPrefix.every((byte, index) => ipv6.bytes[index] === byte)
  ) {
    return classifyIpAddress(ipv6.bytes.slice(12).join("."));
  }

  const allZero = ipv6.bytes.every((byte) => byte === 0);
  const loopback =
    ipv6.bytes.slice(0, 15).every((byte) => byte === 0) &&
    ipv6.bytes[15] === 1;
  if (allZero) {
    return {
      address: ipv6.address,
      family: 6,
      category: "unspecified",
      public: false,
      connectableWithOverride: false,
    };
  }
  if (loopback) {
    return {
      address: ipv6.address,
      family: 6,
      category: "loopback",
      public: false,
      connectableWithOverride: true,
    };
  }
  if ((ipv6.bytes[0] & 0xfe) === 0xfc) {
    return {
      address: ipv6.address,
      family: 6,
      category: "unique-local",
      public: false,
      connectableWithOverride: true,
    };
  }
  if (
    ipv6.bytes[0] === 0xfe &&
    (ipv6.bytes[1] & 0xc0) === 0x80
  ) {
    return {
      address: ipv6.address,
      family: 6,
      category: "link-local",
      public: false,
      connectableWithOverride: true,
    };
  }
  if (ipv6.bytes[0] === 0xff) {
    return {
      address: ipv6.address,
      family: 6,
      category: "multicast",
      public: false,
      connectableWithOverride: false,
    };
  }

  const special = IPV6_BLOCKS.find(({ bytes, prefixLength }) =>
    ipv6HasPrefix(ipv6.bytes, bytes, prefixLength),
  );
  const globalUnicast = (ipv6.bytes[0] & 0xe0) === 0x20;
  return {
    address: ipv6.address,
    family: 6,
    category: special?.category ?? (globalUnicast ? "public" : "reserved"),
    public: globalUnicast && !special,
    connectableWithOverride:
      special?.connectableWithOverride ?? globalUnicast,
  };
}

function normalizeLookupResult(result) {
  const values = Array.isArray(result) ? result : [result];
  const unique = new Map();
  for (const entry of values) {
    const address = typeof entry === "string" ? entry : entry?.address;
    if (typeof address !== "string") {
      throw new DestinationPolicyError(
        "DNS returned an invalid address.",
        "DESTINATION_DNS_INVALID",
      );
    }
    const classification = classifyIpAddress(address);
    unique.set(
      `${classification.family}:${classification.address}`,
      classification,
    );
  }
  return [...unique.values()];
}

export async function resolveDestination(host, options = {}) {
  const mode = options.mode ?? "hosted";
  const allowPrivate = options.allowPrivate === true;
  const lookup = options.lookup ?? defaultLookup;
  if (mode !== "hosted" && mode !== "local") {
    throw new Error('mode must be "hosted" or "local".');
  }
  if (mode === "hosted" && allowPrivate) {
    throw new DestinationPolicyError(
      "Hosted mode cannot allow private destinations.",
      "DESTINATION_POLICY_INVALID",
    );
  }

  let addresses;
  if (isIP(host)) {
    addresses = [classifyIpAddress(host)];
  } else {
    const answer = await lookup(host, { all: true, verbatim: true });
    addresses = normalizeLookupResult(answer);
  }
  if (addresses.length === 0) {
    throw new DestinationPolicyError(
      "The destination did not resolve to an address.",
      "DESTINATION_DNS_EMPTY",
    );
  }

  const blocked = addresses.find(({ public: isPublic }) => !isPublic);
  if (!allowPrivate && blocked) {
    throw new DestinationPolicyError(
      `The destination resolves to a non-public address (${blocked.category}).`,
    );
  }
  const unusable = addresses.find(
    ({ public: isPublic, connectableWithOverride }) =>
      !isPublic && !connectableWithOverride,
  );
  if (unusable) {
    throw new DestinationPolicyError(
      `The destination resolves to an unusable address (${unusable.category}).`,
    );
  }

  const selected = addresses[0];
  return {
    address: selected.address,
    family: selected.family,
    category: selected.category,
    resolvedCount: addresses.length,
  };
}
