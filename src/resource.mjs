import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fetchGopher } from "./client.mjs";
import { resolveDestination } from "./network-policy.mjs";
import {
  decodeTextResponse,
  itemType,
  parseGopherUrl,
  parseMenu,
  toGopherUrl,
} from "../site/protocol.mjs";

const MENU_TYPES = new Set(["1", "7", "+"]);
const TEXT_TYPES = new Set(["0", "3"]);
const BINARY_TYPES = new Set(["4", "5", "6", "9", "g", "I", "s", "d", "P"]);

function externalUrl(selector) {
  if (!selector.startsWith("URL:")) return null;
  try {
    const url = new URL(selector.slice(4));
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function mediaTypeFor(type, selector) {
  const extension = selector.split(/[\\/]/u).at(-1)?.split(".").at(-1)?.toLowerCase();
  if (type === "g") return "image/gif";
  if (type === "P" || extension === "pdf") return "application/pdf";
  if (type === "s") {
    if (extension === "wav") return "audio/wav";
    if (extension === "ogg") return "audio/ogg";
    return "audio/mpeg";
  }
  if (type === "I") {
    if (extension === "png") return "image/png";
    if (extension === "webp") return "image/webp";
    if (extension === "svg") return "image/svg+xml";
    return "image/jpeg";
  }
  if (type === "4") return "application/mac-binhex40";
  if (type === "6") return "application/x-uuencode";
  if (TEXT_TYPES.has(type)) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function suggestedFilename(target) {
  const fallback = target.type === "g" ? "gopher.gif" : "gopher-resource.bin";
  const segment = target.selector.split(/[\\/]/u).filter(Boolean).at(-1);
  if (!segment) return fallback;
  const safe = segment.replace(/[^a-z0-9._-]+/giu, "-").replace(/^-+|-+$/gu, "");
  return safe || fallback;
}

function menuEntryModel(entry) {
  const kind = itemType(entry.type);
  let url = null;
  let webUrl = null;
  if (entry.valid && entry.type === "h") {
    webUrl = externalUrl(entry.selector);
  } else if (entry.valid && kind.requestable) {
    url = toGopherUrl({
      host: entry.host,
      port: entry.port,
      type: entry.type,
      selector: entry.selector,
    });
  }
  return {
    type: entry.type,
    typeLabel: kind.label,
    icon: kind.icon,
    label: entry.label,
    selector: entry.selector,
    host: entry.host,
    port: entry.port,
    valid: entry.valid,
    requestable: Boolean(url),
    requiresQuery: entry.type === "7",
    url,
    externalUrl: webUrl,
    raw: entry.raw,
  };
}

function responseDigest(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

export async function fetchGopherResource(address, options = {}) {
  let parsed;
  try {
    parsed = parseGopherUrl(address);
  } catch (error) {
    throw Object.assign(new Error(error.message), {
      code: "ADDRESS_INVALID",
    });
  }
  const query = Object.hasOwn(options, "query") ? options.query : parsed.query;
  const target = { ...parsed, query };
  const canonicalUrl = toGopherUrl(target);
  const type = itemType(target.type);

  if (target.type === "h") {
    const webUrl = externalUrl(target.selector);
    if (!webUrl) {
      throw Object.assign(
        new Error("This HTML item does not contain a supported HTTP or HTTPS URL."),
        { code: "ITEM_NOT_REQUESTABLE" },
      );
    }
    return {
      schemaVersion: 1,
      address: canonicalUrl,
      kind: "external",
      itemType: target.type,
      itemTypeLabel: type.label,
      target,
      externalUrl: webUrl,
      byteLength: 0,
      sha256: null,
      durationMs: 0,
    };
  }
  if (!type.requestable) {
    throw Object.assign(
      new Error(`${type.label} items are not requestable by this client.`),
      { code: "ITEM_NOT_REQUESTABLE" },
    );
  }
  if (target.type === "7" && (query === null || query === "")) {
    throw Object.assign(new Error("Search items require a query."), {
      code: "SEARCH_QUERY_REQUIRED",
    });
  }

  const destination = await resolveDestination(target.host, {
    mode: options.mode ?? "hosted",
    allowPrivate: options.allowPrivate === true,
    lookup: options.lookup,
  });
  const fetcher = options.fetcher ?? fetchGopher;
  const startedAt = performance.now();
  const payloadValue = await fetcher(canonicalUrl, {
    encoding: null,
    timeoutMs: options.timeoutMs,
    idleTimeoutMs: options.idleTimeoutMs,
    maxBytes: options.maxBytes,
    signal: options.signal,
    query,
    connectAddress: destination.address,
    connectFamily: destination.family,
  });
  const payload = Buffer.isBuffer(payloadValue)
    ? payloadValue
    : Buffer.from(payloadValue);
  const common = {
    schemaVersion: 1,
    address: canonicalUrl,
    itemType: target.type,
    itemTypeLabel: type.label,
    target,
    connection: {
      family: destination.family,
      address: destination.address,
      policy: destination.category,
      resolvedCount: destination.resolvedCount,
    },
    byteLength: payload.length,
    sha256: responseDigest(payload),
    durationMs: Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10),
  };

  if (MENU_TYPES.has(target.type)) {
    return {
      ...common,
      kind: "menu",
      mediaType: "application/gopher-menu+json",
      entries: parseMenu(payload.toString("utf8")).map(menuEntryModel),
      ...(options.includeRaw === true
        ? {
            raw: {
              encoding: "base64",
              data: payload.toString("base64"),
              sha256: common.sha256,
            },
          }
        : {}),
    };
  }
  if (TEXT_TYPES.has(target.type)) {
    return {
      ...common,
      kind: "text",
      mediaType: mediaTypeFor(target.type, target.selector),
      text: decodeTextResponse(payload.toString("utf8")),
      ...(options.includeRaw === true
        ? {
            raw: {
              encoding: "base64",
              data: payload.toString("base64"),
              sha256: common.sha256,
            },
          }
        : {}),
    };
  }
  if (BINARY_TYPES.has(target.type)) {
    return {
      ...common,
      kind: "binary",
      mediaType: mediaTypeFor(target.type, target.selector),
      encoding: "base64",
      data: payload.toString("base64"),
      suggestedFilename: suggestedFilename(target),
    };
  }
  throw Object.assign(new Error("The item type is not supported."), {
    code: "ITEM_NOT_REQUESTABLE",
  });
}
