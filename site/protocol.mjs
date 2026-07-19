export const MAX_GOPHER_URL_CHARS = 8_192;
export const MAX_REQUEST_BYTES = 8_192;
export const MAX_MENU_ENTRIES = 10_000;

const ITEM_TYPES = Object.freeze({
  "0": { label: "Text", icon: "TXT", navigable: true },
  "1": { label: "Directory", icon: "DIR", navigable: true },
  "2": { label: "CSO search", icon: "CSO", navigable: false },
  "3": { label: "Error", icon: "ERR", navigable: false },
  "4": { label: "BinHex", icon: "HEX", navigable: false },
  "5": { label: "DOS binary", icon: "BIN", navigable: false },
  "6": { label: "UUencoded", icon: "UUE", navigable: false },
  "7": { label: "Search", icon: "ASK", navigable: true },
  "8": { label: "Telnet", icon: "TEL", navigable: false },
  "9": { label: "Binary", icon: "BIN", navigable: false },
  g: { label: "GIF image", icon: "GIF", navigable: false },
  I: { label: "Image", icon: "IMG", navigable: false },
  i: { label: "Information", icon: "INF", navigable: false },
  h: { label: "HTML link", icon: "WEB", navigable: false },
});

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const VISIBLE_ASCII = /^[\u0021-\u007e]$/u;

export function itemType(type) {
  return ITEM_TYPES[type] ?? { label: "Unknown", icon: "???", navigable: false };
}

function validateType(type) {
  if (typeof type !== "string" || !VISIBLE_ASCII.test(type) || type === "/") {
    throw new Error("The item type must be one visible ASCII character.");
  }
}

function validateField(value, name) {
  if (typeof value !== "string" || CONTROL_CHARACTERS.test(value)) {
    throw new Error(`${name} cannot contain tabs, line breaks, or control characters.`);
  }
}

function decodeField(value, name) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`The ${name} contains invalid percent encoding.`);
  }
}

function normalizeHost(input) {
  let value = String(input ?? "");
  if (value !== value.trim() || !value || /[\s/?#@\\]/u.test(value)) {
    throw new Error("The host contains invalid URL characters.");
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    value = value.slice(1, -1);
  } else if (value.includes("[") || value.includes("]")) {
    throw new Error("The host has invalid IPv6 brackets.");
  }

  const authority = value.includes(":") ? `[${value}]` : value;
  let candidate;
  try {
    candidate = new URL(`http://${authority}/`);
  } catch {
    throw new Error("The host is not valid.");
  }
  if (candidate.username || candidate.password || candidate.port || candidate.pathname !== "/") {
    throw new Error("The host is not valid.");
  }

  const normalized = candidate.hostname.startsWith("[")
    ? candidate.hostname.slice(1, -1)
    : candidate.hostname;
  if (!normalized) throw new Error("The host is not valid.");
  return normalized;
}

function parseAuthority(authority) {
  if (!authority || authority.includes("@")) {
    throw new Error(authority ? "Gopher URLs cannot include credentials." : "The URL needs a host.");
  }

  let host;
  let rawPort = "";
  let portSpecified = false;
  if (authority.startsWith("[")) {
    const match = /^\[([^\]]+)\](?::([^:]+))?$/u.exec(authority);
    if (!match) throw new Error("The URL has an invalid IPv6 authority.");
    [, host, rawPort = ""] = match;
    portSpecified = match[2] !== undefined;
  } else {
    const separator = authority.lastIndexOf(":");
    if (separator >= 0) {
      if (authority.indexOf(":") !== separator) {
        throw new Error("IPv6 hosts must be enclosed in brackets.");
      }
      host = authority.slice(0, separator);
      rawPort = authority.slice(separator + 1);
      portSpecified = true;
    } else {
      host = authority;
    }
  }

  const normalizedHost = normalizeHost(host);
  if (portSpecified && !rawPort) {
    throw new Error("The port must be a number between 1 and 65535.");
  }
  if (rawPort && !/^\d+$/u.test(rawPort)) {
    throw new Error("The port must be a number between 1 and 65535.");
  }
  const port = rawPort ? Number(rawPort) : 70;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("The port must be between 1 and 65535.");
  }
  return { host: normalizedHost, port };
}

/** Parse the RFC 4266 Gopher URI shape without normalizing selector dot-segments. */
export function parseGopherUrl(input) {
  if (typeof input !== "string" || input.length > MAX_GOPHER_URL_CHARS) {
    throw new Error(`Gopher URLs must be strings no longer than ${MAX_GOPHER_URL_CHARS} characters.`);
  }
  if (input !== input.trim()) {
    throw new Error("Remove whitespace before or after the Gopher URL.");
  }

  const scheme = /^gopher:\/\//iu.exec(input);
  if (!scheme) throw new Error("DIG accepts only gopher:// URLs.");
  const remainder = input.slice(scheme[0].length);
  const pathSeparator = remainder.indexOf("/");
  const authority = pathSeparator < 0 ? remainder : remainder.slice(0, pathSeparator);
  const rawPath = pathSeparator < 0 ? "" : remainder.slice(pathSeparator + 1);
  if (/[?#]/u.test(authority) || /[?#]/u.test(rawPath)) {
    throw new Error("Encode question marks and hashes when they are part of a selector.");
  }

  const { host, port } = parseAuthority(authority);
  const fields = rawPath.split(/%09/iu);
  if (fields.length > 2) {
    throw new Error("DIG does not support Gopher+ URL fields.");
  }

  const itemPath = decodeField(fields[0], "URL path");
  const [type = "1", ...selectorCharacters] = [...itemPath];
  const selector = itemPath ? selectorCharacters.join("") : "";
  const query = fields.length === 2 ? decodeField(fields[1], "search query") : null;
  validateType(type);
  validateField(selector, "Selectors");
  if (query !== null) validateField(query, "Search queries");

  return { host, port, type, selector, query };
}

export function toGopherUrl({ host, port = 70, type = "1", selector = "", query = null }) {
  const normalizedHost = normalizeHost(host);
  const normalizedPort = Number(port);
  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65_535) {
    throw new Error("The port must be between 1 and 65535.");
  }
  validateType(type);
  validateField(selector, "Selectors");
  if (query !== null) validateField(query, "Search queries");

  const authorityHost = normalizedHost.includes(":") ? `[${normalizedHost}]` : normalizedHost;
  const authority = normalizedPort === 70 ? authorityHost : `${authorityHost}:${normalizedPort}`;
  const encodedSelector = encodeURIComponent(selector).replaceAll("%2F", "/");
  const encodedQuery = query === null ? "" : `%09${encodeURIComponent(query)}`;
  const result = `gopher://${authority}/${encodeURIComponent(type)}${encodedSelector}${encodedQuery}`;
  if (result.length > MAX_GOPHER_URL_CHARS) {
    throw new Error(`Gopher URLs cannot exceed ${MAX_GOPHER_URL_CHARS} characters.`);
  }
  return result;
}

export function parseMenu(payload, options = {}) {
  const maxEntries = options.maxEntries ?? MAX_MENU_ENTRIES;
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_MENU_ENTRIES) {
    throw new Error(`maxEntries must be between 1 and ${MAX_MENU_ENTRIES}.`);
  }

  const lines = String(payload).replaceAll("\r\n", "\n").split("\n");
  const entries = [];

  for (const [index, line] of lines.entries()) {
    if (line === ".") break;
    if (line === "") continue;
    if (entries.length >= maxEntries) {
      throw new Error(`Menu exceeded the ${maxEntries}-entry limit.`);
    }
    const type = line[0];
    const fields = line.slice(1).split("\t");
    if (fields.length < 4) {
      entries.push({
        type: "3",
        label: `Malformed line ${index + 1}`,
        selector: "",
        host: "",
        port: 0,
        valid: false,
        raw: line,
      });
      continue;
    }

    const [label, selector, host, rawPort] = fields;
    const port = Number(rawPort);
    let valid = Boolean(label && host && Number.isInteger(port) && port >= 1 && port <= 65_535);
    if (valid) {
      try {
        toGopherUrl({ host, port, type, selector });
      } catch {
        valid = false;
      }
    }
    entries.push({ type, label, selector, host, port, valid, raw: line });
  }
  return entries;
}

export function selectorRequest(selector, query = null) {
  validateField(selector, "Selectors");
  if (query !== null) validateField(query, "Search queries");
  const request = `${selector}${query === null ? "" : `\t${query}`}\r\n`;
  if (new TextEncoder().encode(request).byteLength > MAX_REQUEST_BYTES) {
    throw new Error(`The encoded request cannot exceed ${MAX_REQUEST_BYTES} bytes.`);
  }
  return request;
}

/** Remove the RFC 1436 terminator from a text response. */
export function decodeTextResponse(payload) {
  const lines = String(payload).replaceAll("\r\n", "\n").split("\n");
  const terminator = lines.indexOf(".");
  return (terminator >= 0 ? lines.slice(0, terminator) : lines).join("\n");
}
