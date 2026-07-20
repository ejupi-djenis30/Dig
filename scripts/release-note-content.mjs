import { isIP } from "node:net";
import { URL, domainToASCII } from "node:url";

const defaultIgnorableCodePointPattern = /\p{Default_Ignorable_Code_Point}/gu;
const controlOrWhitespacePattern = /[\p{White_Space}\p{Cc}]+/gu;
const unicodeDotPattern = /[\u3002\uFF0E\uFF61]/gu;
const letterOrNumberPattern = /[\p{L}\p{N}]/u;
const openingParenthesisPattern = /^\p{Ps}$/u;
const closingParenthesisPattern = /^\p{Pe}$/u;
const openingQuotePattern = /^\p{Pi}$/u;
const closingQuotePattern = /^\p{Pf}$/u;
const schemePattern = /^([A-Za-z][A-Za-z\d+.-]*):(.*)$/u;
const scpReferencePattern = /^([^@\s]+)@([^:\s]+):(.+)$/u;
const ipvFuturePattern = /^v[\da-f]+\.[A-Za-z\d._~!$&'()*+,;=:-]+$/iu;
const pathSegmentPattern = /^[\p{L}\p{N}@._+~-]+$/u;
const proseLabelPattern = /^\p{Lu}[\p{Ll}\p{M}]{1,31}$/u;
const nodeBuiltinPattern = /^node:[a-z\d][a-z\d._-]*(?:\/[a-z\d][a-z\d._-]*)*$/iu;
const npmScopedPackagePattern = /^(?:npm:)?@[a-z\d][a-z\d._-]*\/[a-z\d][a-z\d._-]*$/iu;
const javascriptTechnologyPattern = /^[a-z][a-z\d-]*\.js$/iu;
const languageTechnologyPattern = /^(?:c(?:\+\+|#)?|go|java|javascript|kotlin|python|ruby|rust|swift|typescript)$/iu;
const namedRuntimePattern = /^(?:deno(?:\.land)?|node)$/iu;
const architecturePattern = /^(?:aarch64|arm64|x64|x86)$/iu;
const acronymPattern = /^[A-Z][A-Z\d]{1,7}$/u;

const knownSchemes = new Set([
  "about", "blob", "data", "file", "ftp", "ftps", "geo", "git", "gopher",
  "http", "https", "ipfs", "ipns", "irc", "ircs", "ldap", "ldaps", "magnet",
  "mailto", "news", "nntp", "node", "npm", "sftp", "sms", "ssh", "tel", "urn",
  "ws", "wss",
]);

const exactWrapperPairs = new Map([
  ["(", ")"], ["[", "]"], ["{", "}"], ["<", ">"],
  ["（", "）"], ["［", "］"], ["｛", "｝"], ["＜", "＞"],
  ["「", "」"], ["『", "』"], ["【", "】"], ["〔", "〕"],
  ["〖", "〗"], ["〘", "〙"], ["〚", "〛"], ["〈", "〉"], ["《", "》"],
  ["⟨", "⟩"], ["⟪", "⟫"], ["«", "»"], ["‹", "›"],
  ["“", "”"], ["‘", "’"], ["„", "“"], ["‚", "‘"],
  ["\"", "\""], ["'", "'"], ["`", "`"],
]);

const compositeSeparators = new Set([";", ",", "|", "&", "+", "=", "~", "_", "…", "—", "–"]);
// Lowercase word/word text is indistinguishable from a repository path without
// vocabulary. Only these symmetric human relations are prose; other paths fail closed.
const humanSlashPairs = new Map([
  ["and", "or"],
  ["before", "after"],
  ["client", "server"],
  ["input", "output"],
  ["read", "write"],
  ["request", "response"],
  ["source", "target"],
  ["up", "down"],
]);
const maximumSegmentationDepth = 32;

export function normalizeReleaseNoteText(value) {
  if (typeof value !== "string") throw new TypeError("Release-note text must be a string.");
  return value
    .normalize("NFKC")
    .replace(defaultIgnorableCodePointPattern, "")
    .replace(unicodeDotPattern, ".")
    .replace(controlOrWhitespacePattern, " ")
    .trim();
}

function wrapperExpectation(character) {
  const exact = exactWrapperPairs.get(character);
  if (exact !== undefined) return { exact };
  if (openingParenthesisPattern.test(character)) return { category: "parenthesis" };
  if (openingQuotePattern.test(character)) return { category: "quote" };
  return null;
}

function matchesWrapper(expectation, character) {
  if (expectation.exact !== undefined) return character === expectation.exact;
  if (expectation.category === "parenthesis") return closingParenthesisPattern.test(character);
  return closingQuotePattern.test(character);
}

function closingWrapperIndex(characters, start) {
  const first = wrapperExpectation(characters[start]);
  if (first === null) return -1;
  const stack = [first];
  for (let index = start + 1; index < characters.length; index += 1) {
    const character = characters[index];
    if (matchesWrapper(stack.at(-1), character)) {
      stack.pop();
      if (stack.length === 0) return index;
      continue;
    }
    const nested = wrapperExpectation(character);
    if (nested !== null) stack.push(nested);
  }
  return -1;
}

function unwrapWholeWrapper(value) {
  const characters = [...value];
  const closingIndex = closingWrapperIndex(characters, 0);
  return closingIndex === characters.length - 1
    ? characters.slice(1, -1).join("")
    : null;
}

// Technology terms are grammar-based rather than a growing token allowlist:
// Node built-ins, npm scopes, named runtimes/languages, architectures, acronyms,
// and slash compounds made entirely from those atoms are treated as prose.
function isTechnologyAtom(value) {
  return javascriptTechnologyPattern.test(value)
    || languageTechnologyPattern.test(value)
    || namedRuntimePattern.test(value)
    || architecturePattern.test(value)
    || acronymPattern.test(value);
}

function isHumanSlashPair(value) {
  const parts = value.toLowerCase().split("/");
  if (parts.length !== 2) return false;
  return humanSlashPairs.get(parts[0]) === parts[1] || humanSlashPairs.get(parts[1]) === parts[0];
}

function isTechnologyExpression(rawValue) {
  const value = rawValue.replace(/[.!?,;]+$/u, "");
  if (nodeBuiltinPattern.test(value) || npmScopedPackagePattern.test(value) || isTechnologyAtom(value)) return true;
  if (isHumanSlashPair(value)) return true;
  const slashParts = value.split("/");
  return slashParts.length > 1 && slashParts.every(isTechnologyAtom);
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

function isDomainHost(value, allowSingleLabel = false) {
  const host = value.endsWith(".") ? value.slice(0, -1) : value;
  const ascii = domainToASCII(host);
  if (ascii === "" || ascii.length > 253) return false;
  const labels = ascii.toLowerCase().split(".");
  const minimumLabels = allowSingleLabel ? 1 : 2;
  return labels.length >= minimumLabels && labels.every((label) => (
    label.length >= 1
    && label.length <= 63
    && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/u.test(label)
  ));
}

function isHostLocation(value, { allowSingleLabel = false } = {}) {
  const host = hostFromLocation(value);
  if (host === null) return false;
  if (host.toLowerCase() === "localhost" || ipvFuturePattern.test(host)) return true;
  return isIpOrLegacyIpv4Host(host) || isDomainHost(host, allowSingleLabel);
}

function isEmailReference(value) {
  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator === value.length - 1) return false;
  const localPart = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  return !/[\s/\\]/u.test(localPart) && isHostLocation(domain, { allowSingleLabel: true });
}

function isScpStyleReference(value) {
  const match = value.match(scpReferencePattern);
  return Boolean(match && isHostLocation(match[2], { allowSingleLabel: true }) && match[3] !== "");
}

function isExplicitPathReference(value) {
  if (/^(?:[/\\]|\.{1,2}(?:[/\\]|$)|~(?:[/\\]|$)|[#?])/u.test(value)) return true;
  if (isTechnologyExpression(value)) return false;
  const segments = value.split(/[\\/]/u);
  return segments.length > 1 && segments.every((segment) => segment !== "" && pathSegmentPattern.test(segment));
}

function isProseLabel(value) {
  return (proseLabelPattern.test(value) || acronymPattern.test(value))
    && !knownSchemes.has(value.toLowerCase());
}

function isProseLabelToken(value) {
  return value.endsWith(":") && isProseLabel(value.slice(0, -1));
}

function isGluedLabelReference(value) {
  for (const delimiter of [":", "—", "–"]) {
    const separator = value.indexOf(delimiter);
    if (separator <= 0) continue;
    const label = value.slice(0, separator);
    const remainder = value.slice(separator + delimiter.length);
    if (isProseLabel(label) && remainder !== "" && isLocationOrReferenceExpression(remainder)) return true;
  }
  return false;
}

function isLocationOrReferenceExpression(value) {
  if (value === "" || /\s/u.test(value) || isTechnologyExpression(value)) return false;
  if (schemePattern.test(value)) return true;
  if (isEmailReference(value) || isScpStyleReference(value)) return true;
  if (isExplicitPathReference(value)) return true;
  return isHostLocation(value);
}

function pushSegment(segments, characters) {
  const value = characters.join("").trim();
  if (value !== "") segments.push(value);
  characters.length = 0;
}

function compositeSegments(value) {
  const characters = [...value];
  const segments = [];
  const current = [];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const closingIndex = closingWrapperIndex(characters, index);
    if (closingIndex !== -1) {
      pushSegment(segments, current);
      const inner = characters.slice(index + 1, closingIndex).join("").trim();
      if (inner !== "") segments.push(inner);
      index = closingIndex;
      continue;
    }
    const isAsciiEllipsis = character === "." && characters[index + 1] === "." && characters[index + 2] === ".";
    if (compositeSeparators.has(character) || isAsciiEllipsis) {
      pushSegment(segments, current);
      if (isAsciiEllipsis) index += 2;
      continue;
    }
    current.push(character);
  }
  pushSegment(segments, current);
  return segments;
}

function hasSubstantiveSegment(rawValue, depth = 0) {
  if (depth > maximumSegmentationDepth) return false;
  const value = rawValue.trim();
  if (!letterOrNumberPattern.test(value)) return false;

  const unwrapped = unwrapWholeWrapper(value);
  if (unwrapped !== null) return hasSubstantiveSegment(unwrapped, depth + 1);
  if (isTechnologyExpression(value) || isGluedLabelReference(value)) return true;

  // Complete references are classified before separators are considered, so URI
  // query characters and path punctuation cannot be mistaken for prose.
  if (isLocationOrReferenceExpression(value)) return false;

  const whitespaceParts = value.split(/ +/u).filter(Boolean);
  if (whitespaceParts.length > 1) {
    for (let index = 0; index < whitespaceParts.length - 1; index += 1) {
      if (
        isProseLabelToken(whitespaceParts[index])
        && letterOrNumberPattern.test(whitespaceParts[index + 1])
        && !hasSubstantiveSegment(whitespaceParts[index + 1], depth + 1)
      ) return true;
    }
    return whitespaceParts.some((part) => hasSubstantiveSegment(part, depth + 1));
  }

  const segments = compositeSegments(value);
  if (segments.length !== 1 || segments[0] !== value) {
    return segments.some((segment) => hasSubstantiveSegment(segment, depth + 1));
  }
  return true;
}

export function isLocationOrReferenceToken(rawValue) {
  const normalized = normalizeReleaseNoteText(rawValue);
  return letterOrNumberPattern.test(normalized) && !hasSubstantiveSegment(normalized);
}

export function hasSubstantiveReleaseNoteText(value) {
  return hasSubstantiveSegment(normalizeReleaseNoteText(value));
}
