import { isIP } from "node:net";
import { URL, domainToASCII } from "node:url";

const defaultIgnorableCodePointPattern = /\p{Default_Ignorable_Code_Point}/gu;
const unicodeDotPattern = /[\u3002\uFF0E\uFF61]/gu;
const explicitSchemePattern = /^[A-Za-z][A-Za-z\d+.-]*:/u;
const scpReferencePattern = /^([^@\s]+)@([^:\s]+):(.+)$/u;
const leadingWrapperPattern = /^[('"“‘<]+/u;
const trailingWrapperPattern = /[)'"”’>,!;]+$/u;
const letterOrNumberPattern = /[\p{L}\p{N}]/u;

// These exact, case-sensitive tokens are well-known technology names used in
// release prose. They intentionally override URI/domain grammar and nothing else.
const technologyTokens = new Set([
  "Deno.land",
  "Node.js",
  "React.js",
  "node:test",
  "npm:@scope/package",
]);

export function normalizeReleaseNoteText(value) {
  if (typeof value !== "string") throw new TypeError("Release-note text must be a string.");
  return value
    .normalize("NFKC")
    .replace(defaultIgnorableCodePointPattern, "")
    .replace(unicodeDotPattern, ".");
}

function unwrapToken(value) {
  return value
    .replace(leadingWrapperPattern, "")
    .replace(trailingWrapperPattern, "");
}

function isTechnologyToken(value) {
  const withoutSentencePunctuation = value.replace(/[.!?,;]+$/u, "");
  return technologyTokens.has(withoutSentencePunctuation);
}

function hostFromLocation(value) {
  const boundary = value.search(/[/?#]/u);
  let authority = boundary === -1 ? value : value.slice(0, boundary);
  if (authority === "") return null;

  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    if (closingBracket === -1) return null;
    const suffix = authority.slice(closingBracket + 1);
    if (suffix !== "" && !/^:\d{1,5}$/u.test(suffix)) return null;
    authority = authority.slice(1, closingBracket);
    if (/^IPv6:/iu.test(authority)) authority = authority.slice("IPv6:".length);
    return authority;
  }

  if (isIP(authority) !== 0) return authority;
  const portSeparator = authority.lastIndexOf(":");
  if (portSeparator !== -1) {
    const port = authority.slice(portSeparator + 1);
    if (!/^\d{1,5}$/u.test(port)) return null;
    authority = authority.slice(0, portSeparator);
  }
  return authority || null;
}

function isIpOrLegacyIpv4Host(value) {
  if (isIP(value) !== 0) return true;
  try {
    // WHATWG host parsing canonicalizes the legacy IPv4 spellings browsers and
    // network clients still accept, including 127.1, hexadecimal, and integers.
    const parsed = new URL(`http://${value}/`);
    const canonicalHost = parsed.hostname.replace(/^\[|\]$/gu, "");
    return isIP(canonicalHost) !== 0;
  } catch {
    return false;
  }
}

function isDomainHost(value) {
  const host = value.endsWith(".") ? value.slice(0, -1) : value;
  if (!host.includes(".")) return false;
  // UTS #46 conversion makes Unicode and punycode hosts follow one validation path.
  const ascii = domainToASCII(host);
  if (ascii === "" || ascii.length > 253) return false;
  const labels = ascii.toLowerCase().split(".");
  return labels.length >= 2 && labels.every((label) => (
    label.length >= 1
    && label.length <= 63
    && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/u.test(label)
  ));
}

function isHostLocation(value) {
  const host = hostFromLocation(value);
  if (host === null) return false;
  if (host.toLowerCase() === "localhost") return true;
  return isIpOrLegacyIpv4Host(host) || isDomainHost(host);
}

function isEmailReference(value) {
  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator === value.length - 1) return false;
  const localPart = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  return !/[\s/\\]/u.test(localPart) && isHostLocation(domain);
}

function isScpStyleReference(value) {
  const match = value.match(scpReferencePattern);
  return Boolean(match && isHostLocation(match[2]) && match[3] !== "");
}

function isPathOrLocatorReference(value) {
  if (/^(?:[/\\]|\.{1,2}(?:[/\\]|$)|[#?])/u.test(value)) return true;
  return /[/\\]/u.test(value);
}

export function isLocationOrReferenceToken(rawValue) {
  const value = unwrapToken(normalizeReleaseNoteText(rawValue));
  if (value === "" || isTechnologyToken(value)) return false;
  if (explicitSchemePattern.test(value)) return true;
  if (isEmailReference(value) || isScpStyleReference(value)) return true;
  if (isPathOrLocatorReference(value)) return true;
  return isHostLocation(value);
}

export function hasSubstantiveReleaseNoteText(value) {
  const normalized = normalizeReleaseNoteText(value);
  for (const rawToken of normalized.split(/\s+/u)) {
    const token = unwrapToken(rawToken);
    if (!letterOrNumberPattern.test(token)) continue;
    if (isTechnologyToken(token) || !isLocationOrReferenceToken(token)) return true;
  }
  return false;
}
