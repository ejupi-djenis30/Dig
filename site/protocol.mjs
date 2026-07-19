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

export function itemType(type) {
  return ITEM_TYPES[type] ?? { label: "Unknown", icon: "???", navigable: false };
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function validateType(type) {
  if (typeof type !== "string" || [...type].length !== 1 || type === "/" || CONTROL_CHARACTERS.test(type)) {
    throw new Error("The item type must be one visible character.");
  }
}

function validateSelector(selector) {
  if (typeof selector !== "string" || CONTROL_CHARACTERS.test(selector)) {
    throw new Error("Selectors cannot contain control characters.");
  }
}

export function parseGopherUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a complete gopher:// URL.");
  }

  if (url.protocol !== "gopher:") {
    throw new Error("DIG accepts only gopher:// URLs.");
  }
  if (!url.hostname) {
    throw new Error("The URL needs a host.");
  }
  if (url.username || url.password) {
    throw new Error("Gopher URLs cannot include credentials.");
  }
  if (url.search || url.hash) {
    throw new Error("Encode question marks and hashes when they are part of a selector.");
  }

  const port = url.port ? Number(url.port) : 70;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("The port must be between 1 and 65535.");
  }

  let rawPath;
  try {
    rawPath = decodeURIComponent(url.pathname || "/");
  } catch {
    throw new Error("The URL path contains invalid percent encoding.");
  }
  const type = rawPath.length > 1 ? rawPath[1] : "1";
  const selector = rawPath.length > 2 ? rawPath.slice(2) : "";
  validateType(type);
  validateSelector(selector);
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  return { host, port, type, selector };
}

export function toGopherUrl({ host, port = 70, type = "1", selector = "" }) {
  const hostValue = String(host ?? "").trim();
  if (!hostValue || /[\s/?#@\\]/u.test(hostValue)) {
    throw new Error("The host contains invalid URL characters.");
  }

  const authorityHost = hostValue.startsWith("[")
    ? hostValue
    : hostValue.includes(":")
      ? `[${hostValue}]`
      : hostValue;
  let normalizedHost;
  try {
    const candidate = new URL(`gopher://${authorityHost}/`);
    normalizedHost = candidate.hostname;
  } catch {
    throw new Error("The host is not valid.");
  }

  const normalizedPort = Number(port);
  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    throw new Error("The port must be between 1 and 65535.");
  }
  validateType(type);
  validateSelector(selector);

  const authority = normalizedPort === 70 ? normalizedHost : `${normalizedHost}:${normalizedPort}`;
  const encodedSelector = selector.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `gopher://${authority}/${encodeURIComponent(type)}${encodedSelector}`;
}

export function parseMenu(payload) {
  const lines = String(payload).replaceAll("\r\n", "\n").split("\n");
  const entries = [];

  for (const [index, line] of lines.entries()) {
    if (line === ".") break;
    if (line === "") continue;
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
    const valid = Boolean(label && host && Number.isInteger(port) && port >= 1 && port <= 65535);
    entries.push({ type, label, selector, host, port, valid, raw: line });
  }
  return entries;
}

export function selectorRequest(selector, query = "") {
  if (CONTROL_CHARACTERS.test(selector) || CONTROL_CHARACTERS.test(query)) {
    throw new Error("Selectors and queries cannot contain line breaks or control characters.");
  }
  return `${selector}${query ? `\t${query}` : ""}\r\n`;
}
