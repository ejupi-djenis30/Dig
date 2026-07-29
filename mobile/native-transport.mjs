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

function codedError(message, code) {
  return Object.assign(new Error(message), { code });
}

function abortError() {
  const error = codedError("The request was cancelled.", "REQUEST_ABORTED");
  error.name = "AbortError";
  return error;
}

function externalUrl(selector) {
  if (!selector.startsWith("URL:")) return null;
  try {
    const url = new URL(selector.slice(4));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
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
  const safe = segment
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^-+|-+$/gu, "");
  return safe || fallback;
}

function decodeBase64(value) {
  if (typeof value !== "string") {
    throw codedError(
      "The Android transport returned an invalid payload.",
      "NATIVE_RESPONSE_INVALID",
    );
  }
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw codedError(
      "The Android transport returned invalid base64.",
      "NATIVE_RESPONSE_INVALID",
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function requestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateNativeResponse(response, bytes) {
  if (
    !response ||
    !Number.isInteger(response.byteLength) ||
    response.byteLength !== bytes.byteLength ||
    typeof response.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(response.sha256) ||
    !Number.isFinite(response.durationMs) ||
    typeof response.connection?.address !== "string" ||
    ![4, 6].includes(response.connection?.family)
  ) {
    throw codedError(
      "The Android transport returned invalid response metadata.",
      "NATIVE_RESPONSE_INVALID",
    );
  }
}

async function fetchNative(plugin, target, canonicalUrl, options) {
  const id = requestId();
  let aborted = options.signal?.aborted === true;
  let rejectForAbort;
  const abortPromise = new Promise((resolve, reject) => {
    rejectForAbort = reject;
  });
  const onAbort = () => {
    aborted = true;
    void plugin.cancel({ requestId: id }).catch(() => {});
    rejectForAbort(abortError());
  };
  if (aborted) throw abortError();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const fetchPromise = plugin.fetch({
      requestId: id,
      host: target.host,
      port: target.port,
      selector: target.selector,
      itemType: target.type,
      ...(target.query === null || target.query === undefined
        ? {}
        : { query: target.query }),
    });
    const response = await (
      options.signal
        ? Promise.race([fetchPromise, abortPromise])
        : fetchPromise
    );
    if (aborted) throw abortError();
    const bytes = decodeBase64(response.data);
    validateNativeResponse(response, bytes);
    return { response, bytes, canonicalUrl };
  } catch (error) {
    if (aborted || error?.code === "REQUEST_ABORTED") throw abortError();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export function createNativeTransport(plugin) {
  if (
    typeof plugin?.getConfig !== "function" ||
    typeof plugin?.fetch !== "function" ||
    typeof plugin?.cancel !== "function" ||
    typeof plugin?.save !== "function"
  ) {
    throw codedError(
      "The Android Gopher plugin is unavailable.",
      "NATIVE_PLUGIN_UNAVAILABLE",
    );
  }

  return Object.freeze({
    async getConfig() {
      const config = await plugin.getConfig();
      if (
        config?.schemaVersion !== 1 ||
        config?.mode !== "android" ||
        typeof config.homeAddress !== "string" ||
        config.requiresAccessToken !== false
      ) {
        throw codedError(
          "The Android Gopher plugin returned an invalid configuration.",
          "NATIVE_CONFIG_INVALID",
        );
      }
      return config;
    },

    async saveFile({ data, mediaType, suggestedFilename }) {
      const result = await plugin.save({ data, mediaType, suggestedFilename });
      if (typeof result?.saved !== "boolean") {
        throw codedError(
          "Android returned an invalid save result.",
          "SAVE_FAILED",
        );
      }
      return result;
    },

    async fetchResource(options) {
      let parsed;
      try {
        parsed = parseGopherUrl(options.address);
      } catch (error) {
        throw codedError(error.message, "ADDRESS_INVALID");
      }
      const query =
        options.query === undefined ? parsed.query : options.query;
      const target = { ...parsed, query };
      const canonicalUrl = toGopherUrl(target);
      const type = itemType(target.type);

      if (target.type === "h") {
        const webUrl = externalUrl(target.selector);
        if (!webUrl) {
          throw codedError(
            "This HTML item does not contain a supported HTTP or HTTPS URL.",
            "ITEM_NOT_REQUESTABLE",
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
        throw codedError(
          `${type.label} items are not requestable by this client.`,
          "ITEM_NOT_REQUESTABLE",
        );
      }
      if (target.type === "7" && (query === null || query === "")) {
        throw codedError("Search items require a query.", "SEARCH_QUERY_REQUIRED");
      }

      const { response, bytes } = await fetchNative(
        plugin,
        target,
        canonicalUrl,
        options,
      );
      const common = {
        schemaVersion: 1,
        address: canonicalUrl,
        itemType: target.type,
        itemTypeLabel: type.label,
        target,
        connection: response.connection,
        byteLength: response.byteLength,
        sha256: response.sha256,
        durationMs: response.durationMs,
      };

      if (MENU_TYPES.has(target.type)) {
        return {
          ...common,
          kind: "menu",
          mediaType: "application/gopher-menu+json",
          entries: parseMenu(new TextDecoder().decode(bytes)).map(menuEntryModel),
          ...(options.includeRaw
            ? {
                raw: {
                  encoding: "base64",
                  data: response.data,
                  sha256: response.sha256,
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
          text: decodeTextResponse(new TextDecoder().decode(bytes)),
          ...(options.includeRaw
            ? {
                raw: {
                  encoding: "base64",
                  data: response.data,
                  sha256: response.sha256,
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
          data: response.data,
          suggestedFilename: suggestedFilename(target),
        };
      }
      throw codedError(
        "The item type is not supported.",
        "ITEM_NOT_REQUESTABLE",
      );
    },
  });
}
