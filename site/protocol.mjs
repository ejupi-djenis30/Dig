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

  const port = url.port ? Number(url.port) : 70;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("The port must be between 1 and 65535.");
  }

  const rawPath = decodeURIComponent(url.pathname || "/");
  const type = rawPath.length > 1 ? rawPath[1] : "1";
  const selector = rawPath.length > 2 ? rawPath.slice(2) : "";
  return { host: url.hostname, port, type, selector };
}

export function toGopherUrl({ host, port = 70, type = "1", selector = "" }) {
  const authority = port === 70 ? host : `${host}:${port}`;
  const path = `/${type}${selector}`
    .split("/")
    .map((part, index) => (index < 2 ? part : encodeURIComponent(part)))
    .join("/");
  return `gopher://${authority}${path}`;
}

export function parseMenu(payload) {
  const lines = String(payload).replaceAll("\r\n", "\n").split("\n");
  const entries = [];

  for (const [index, line] of lines.entries()) {
    if (line === "." || line === "") continue;
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
  if (selector.includes("\r") || selector.includes("\n") || query.includes("\r") || query.includes("\n")) {
    throw new Error("Selectors and queries cannot contain line breaks.");
  }
  return `${selector}${query ? `\t${query}` : ""}\r\n`;
}
