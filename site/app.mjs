import {
  itemType,
  parseGopherUrl,
  parseMenu,
  toGopherUrl,
} from "./protocol.mjs?v=3.0.0";

const BOOKMARK_KEY = "dig.bookmarks.v1";
const HISTORY_KEY = "dig.history.v1";
const TOKEN_KEY = "dig.access-token.v1";
const MAX_BOOKMARKS = 50;
const MAX_HISTORY = 100;

function storage(name) {
  try {
    return window[name];
  } catch {
    const values = new Map();
    return {
      getItem(key) {
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        values.set(key, String(value));
      },
    };
  }
}

const sessionStore = storage("sessionStorage");
const localStore = storage("localStorage");

const elements = {
  app: document.querySelector("[data-explorer-app]"),
  form: document.querySelector("[data-address-form]"),
  address: document.querySelector("[data-address]"),
  go: document.querySelector("[data-go]"),
  mode: document.querySelector("[data-mode]"),
  status: document.querySelector("[data-fixture-status]"),
  securityBanner: document.querySelector("[data-security-banner]"),
  accessForm: document.querySelector("[data-access-form]"),
  accessToken: document.querySelector("[data-access-token]"),
  searchForm: document.querySelector("[data-search-form]"),
  searchQuery: document.querySelector("[data-search-query]"),
  searchTarget: document.querySelector("[data-search-target]"),
  searchCancel: document.querySelector("[data-search-cancel]"),
  resource: document.querySelector("[data-resource]"),
  resourceHeading: document.querySelector("[data-resource-heading]"),
  count: document.querySelector("[data-count]"),
  back: document.querySelector("[data-back]"),
  forward: document.querySelector("[data-forward]"),
  home: document.querySelector("[data-home]"),
  bookmark: document.querySelector("[data-bookmark]"),
  rawToggle: document.querySelector("[data-raw-toggle]"),
  export: document.querySelector("[data-export]"),
  clearHistory: document.querySelector("[data-clear-history]"),
  clearBookmarks: document.querySelector("[data-clear-bookmarks]"),
  historyList: document.querySelector("[data-history-list]"),
  bookmarkList: document.querySelector("[data-bookmark-list]"),
  traceAnnouncement: document.querySelector("[data-trace-announcement]"),
  trace: {
    type: document.querySelector("[data-type]"),
    typeName: document.querySelector("[data-type-name]"),
    label: document.querySelector("[data-label]"),
    selector: document.querySelector("[data-selector]"),
    host: document.querySelector("[data-host]"),
    port: document.querySelector("[data-port]"),
    bytes: document.querySelector("[data-bytes]"),
    sha: document.querySelector("[data-sha]"),
    raw: document.querySelector("[data-raw]"),
  },
};

let config = null;
let currentResource = null;
let pendingSearchAddress = null;
let includeRaw = false;
let navigationController = null;
let accessToken = readString(TOKEN_KEY, sessionStore);
let history = readLocations(HISTORY_KEY, sessionStore, MAX_HISTORY, true);
let historyIndex = history.length - 1;
let bookmarks = readLocations(
  BOOKMARK_KEY,
  localStore,
  MAX_BOOKMARKS,
  false,
);

function readString(key, targetStorage) {
  try {
    const value = targetStorage.getItem(key);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function readStored(key, storage, fallback) {
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "null");
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, storage, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    setStatus("Browser storage is unavailable; this session still works.");
  }
}

function readLocations(key, targetStorage, maximum, newestAtEnd) {
  const clean = readStored(key, targetStorage, []).flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.address !== "string" ||
      entry.address.length === 0 ||
      entry.address.length > 2_048
    ) {
      return [];
    }
    return [
      {
        address: entry.address,
        label:
          typeof entry.label === "string"
            ? entry.label.slice(0, 160)
            : entry.address.slice(0, 160),
      },
    ];
  });
  return newestAtEnd ? clean.slice(-maximum) : clean.slice(0, maximum);
}

function setStatus(message, tone = "neutral") {
  elements.status.dataset.tone = tone;
  elements.status.replaceChildren();
  const dot = document.createElement("span");
  dot.setAttribute("aria-hidden", "true");
  dot.textContent = "●";
  elements.status.append(dot, document.createTextNode(` ${message}`));
}

function setBusy(busy) {
  elements.app.setAttribute("aria-busy", String(busy));
  elements.go.disabled = busy || config?.transport === "fixture";
}

function safeFilename(value, fallback = "dig-resource") {
  const normalized = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || fallback;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function historyEntry(address, label = address) {
  return { address, label: String(label).slice(0, 160) };
}

function updateNavigationControls() {
  elements.back.disabled = config?.transport !== "live" || historyIndex <= 0;
  elements.forward.disabled =
    config?.transport !== "live" || historyIndex >= history.length - 1;
  elements.bookmark.disabled = !currentResource;
  elements.export.disabled = !currentResource;
  const isSaved = bookmarks.some(
    ({ address }) => address === currentResource?.address,
  );
  elements.bookmark.textContent = isSaved
    ? "Remove bookmark"
    : "Save bookmark";
}

function renderLocationList(container, values, ordered = false) {
  container.replaceChildren();
  if (values.length === 0) {
    const item = document.createElement("li");
    item.className = "empty-state";
    item.textContent = ordered ? "No navigation yet." : "No saved addresses.";
    container.append(item);
    return;
  }
  const fragment = document.createDocumentFragment();
  values.forEach((entry, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = entry.label || entry.address;
    const address = document.createElement("code");
    address.textContent = entry.address;
    button.append(address);
    button.addEventListener("click", () => {
      if (ordered) historyIndex = index;
      void navigate(entry.address, { push: !ordered });
    });
    item.append(button);
    fragment.append(item);
  });
  container.append(fragment);
}

function renderLibraries() {
  renderLocationList(elements.historyList, history, true);
  renderLocationList(elements.bookmarkList, bookmarks, false);
  updateNavigationControls();
}

function pushHistory(address, label) {
  if (history[historyIndex]?.address === address) {
    history[historyIndex] = historyEntry(address, label);
  } else {
    history = history.slice(0, historyIndex + 1);
    history.push(historyEntry(address, label));
    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length - 1;
  }
  writeStored(HISTORY_KEY, sessionStore, history);
  renderLibraries();
}

function menuEntryFromFixture(entry) {
  const kind = itemType(entry.type);
  let url = null;
  let externalUrl = null;
  if (entry.valid && entry.type === "h" && entry.selector.startsWith("URL:")) {
    try {
      const candidate = new URL(entry.selector.slice(4));
      if (["http:", "https:"].includes(candidate.protocol)) {
        externalUrl = candidate.href;
      }
    } catch {
      externalUrl = null;
    }
  } else if (entry.valid && kind.requestable) {
    url = toGopherUrl(entry);
  }
  return {
    ...entry,
    typeLabel: kind.label,
    icon: kind.icon,
    requestable: false,
    requiresQuery: entry.type === "7",
    url,
    externalUrl,
  };
}

function setTrace(model) {
  const type = model.type ?? model.itemType ?? "—";
  const kind = itemType(type);
  const target = model.target ?? model;
  elements.trace.type.textContent = kind.icon;
  elements.trace.typeName.textContent =
    type === "—" ? "—" : `${type} · ${model.typeLabel ?? model.itemTypeLabel ?? kind.label}`;
  elements.trace.label.textContent =
    model.label ?? model.address ?? "Gopher resource";
  elements.trace.selector.textContent = target.selector || "(root)";
  elements.trace.host.textContent = target.host || "—";
  elements.trace.port.textContent = target.port || "—";
  elements.trace.bytes.textContent =
    Number.isInteger(model.byteLength) ? String(model.byteLength) : "—";
  elements.trace.sha.textContent = model.sha256 ?? "—";
  if (model.raw?.encoding === "base64") {
    elements.trace.raw.textContent =
      `${model.raw.data.length} base64 characters / digest verified\n\n${model.raw.data.slice(0, 2_048)}${model.raw.data.length > 2_048 ? "\n… preview truncated; export JSON for the complete value." : ""}`;
  } else if (
    typeof model.raw === "string" &&
    currentResource?.raw?.encoding === "base64"
  ) {
    elements.trace.raw.textContent =
      `${model.raw}\n\nFull response: ${currentResource.raw.data.length} base64 characters / digest verified\n\n${currentResource.raw.data.slice(0, 2_048)}${currentResource.raw.data.length > 2_048 ? "\n… preview truncated; export JSON for the complete value." : ""}`;
  } else {
    elements.trace.raw.textContent = model.raw ?? "Raw bytes are opt-in.";
  }
  elements.traceAnnouncement.textContent =
    `${elements.trace.label.textContent}. ${elements.trace.typeName.textContent}. ` +
    `Selector ${elements.trace.selector.textContent}, host ${elements.trace.host.textContent}, ` +
    `port ${elements.trace.port.textContent}.`;
}

function menuButton(entry) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-item";
  const icon = document.createElement("span");
  icon.textContent = entry.icon;
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = entry.label;
  const meta = document.createElement("small");
  meta.textContent = entry.valid
    ? `${entry.typeLabel} · ${entry.host}:${entry.port}`
    : entry.type === "i"
      ? "Information line"
      : "Malformed menu line";
  copy.append(title, meta);
  const action = document.createElement("i");
  action.setAttribute("aria-hidden", "true");
  action.textContent =
    config.transport === "fixture"
      ? "inspect"
      : entry.requiresQuery
        ? "query"
        : entry.requestable
          ? "open"
          : "inspect";
  button.append(icon, copy, action);
  button.addEventListener("click", () => {
    document
      .querySelectorAll(".menu-item")
      .forEach((item) => item.removeAttribute("aria-current"));
    button.setAttribute("aria-current", "true");
    setTrace(entry);
    if (config.transport !== "live") return;
    if (entry.requiresQuery && entry.url) {
      pendingSearchAddress = entry.url;
      elements.searchTarget.textContent = `Query ${entry.label} at ${entry.host}:${entry.port}.`;
      elements.searchForm.hidden = false;
      elements.searchQuery.focus();
    } else if (entry.requestable && entry.url) {
      void navigate(entry.url);
    }
  });
  return button;
}

function renderMenu(resource) {
  const fragment = document.createDocumentFragment();
  resource.entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "menu-row";
    row.append(menuButton(entry));
    if (entry.externalUrl) {
      const link = document.createElement("a");
      link.href = entry.externalUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open web link ↗";
      link.className = "external-item-link";
      row.append(link);
    }
    fragment.append(row);
  });
  elements.resource.replaceChildren(fragment);
  elements.resourceHeading.textContent = "GOPHER MENU";
  elements.count.textContent = `${resource.entries.length} items`;
  const first = elements.resource.querySelector(".menu-item");
  if (resource.entries[0] && first) {
    first.setAttribute("aria-current", "true");
    setTrace(resource.entries[0]);
  }
}

function renderText(resource) {
  const text = document.createElement("pre");
  text.className = "text-resource";
  text.textContent = resource.text;
  elements.resource.replaceChildren(text);
  elements.resourceHeading.textContent = "TEXT RESPONSE";
  elements.count.textContent = `${resource.byteLength} bytes`;
}

function renderBinary(resource) {
  const card = document.createElement("div");
  card.className = "binary-resource";
  const title = document.createElement("h3");
  title.textContent = "Binary response kept intact";
  const copy = document.createElement("p");
  copy.textContent = `${resource.byteLength} bytes · ${resource.mediaType}. DIG does not preview untrusted binary data.`;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Save exact bytes";
  button.addEventListener("click", () => {
    const bytes = Uint8Array.from(atob(resource.data), (character) =>
      character.charCodeAt(0),
    );
    downloadBlob(
      new Blob([bytes], { type: resource.mediaType }),
      safeFilename(resource.suggestedFilename),
    );
  });
  card.append(title, copy, button);
  elements.resource.replaceChildren(card);
  elements.resourceHeading.textContent = "BINARY RESPONSE";
  elements.count.textContent = `${resource.byteLength} bytes`;
}

function renderExternal(resource) {
  const card = document.createElement("div");
  card.className = "binary-resource";
  const title = document.createElement("h3");
  title.textContent = "This item points to the web";
  const copy = document.createElement("p");
  copy.textContent = resource.externalUrl;
  const link = document.createElement("a");
  link.href = resource.externalUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Open external address ↗";
  card.append(title, copy, link);
  elements.resource.replaceChildren(card);
  elements.resourceHeading.textContent = "EXTERNAL LINK";
  elements.count.textContent = "No Gopher bytes";
}

function renderResource(resource) {
  currentResource = resource;
  elements.address.value = resource.address;
  if (resource.kind === "menu") renderMenu(resource);
  if (resource.kind === "text") renderText(resource);
  if (resource.kind === "binary") renderBinary(resource);
  if (resource.kind === "external") renderExternal(resource);
  if (resource.kind !== "menu") setTrace(resource);
  renderLibraries();
}

async function fetchResource(address, query, signal) {
  const headers = { "content-type": "application/json" };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  const response = await fetch("api/fetch", {
    method: "POST",
    headers,
    cache: "no-store",
    signal,
    body: JSON.stringify({
      address,
      includeRaw,
      ...(query === undefined ? {} : { query }),
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      body?.error?.message ?? `The gateway returned HTTP ${response.status}.`,
    );
    error.code = body?.error?.code;
    throw error;
  }
  return body;
}

async function navigate(address, options = {}) {
  if (config.transport !== "live") return;
  navigationController?.abort();
  const controller = new AbortController();
  navigationController = controller;
  setBusy(true);
  elements.searchForm.hidden = true;
  try {
    parseGopherUrl(address);
    const resource = await fetchResource(
      address,
      options.query,
      controller.signal,
    );
    renderResource(resource);
    if (options.push !== false) {
      pushHistory(resource.address, resource.address);
    } else {
      renderLibraries();
    }
    setStatus(
      `Fetched ${resource.byteLength} bytes in ${resource.durationMs} ms. SHA-256 ${resource.sha256 ?? "not applicable"}.`,
      "success",
    );
  } catch (error) {
    if (error.name === "AbortError") return;
    if (error.code === "AUTH_REQUIRED") {
      elements.accessForm.hidden = false;
      elements.accessToken.focus();
    }
    elements.resourceHeading.textContent = "REQUEST FAILED";
    elements.count.textContent = error.code ?? "Error";
    const message = document.createElement("p");
    message.className = "error-resource";
    message.textContent = error.message;
    elements.resource.replaceChildren(message);
    setStatus(error.message, "error");
  } finally {
    if (navigationController === controller) {
      navigationController = null;
      setBusy(false);
    }
  }
}

async function loadFixture() {
  const response = await fetch("fixtures/root.txt?v=3.0.0");
  if (!response.ok) {
    throw new Error(`Fixture request returned HTTP ${response.status}.`);
  }
  const entries = parseMenu(await response.text()).map(menuEntryFromFixture);
  const target = parseGopherUrl("gopher://dig.local/1/");
  renderResource({
    schemaVersion: 1,
    address: "gopher://dig.local/1/",
    kind: "menu",
    itemType: "1",
    itemTypeLabel: "Directory",
    target,
    byteLength: null,
    sha256: null,
    entries,
  });
}

async function configure() {
  try {
    const response = await fetch("api/config", { cache: "no-store" });
    if (!response.ok) throw new Error("The local gateway is not available.");
    config = { ...(await response.json()), transport: "live" };
    elements.mode.textContent = `${config.mode} / live TCP`;
    elements.address.readOnly = false;
    elements.address.removeAttribute("aria-readonly");
    elements.securityBanner.hidden = !config.privateDestinationWarning;
    elements.securityBanner.textContent =
      config.privateDestinationWarning ?? "";
    if (config.requiresAccessToken && !accessToken) {
      elements.accessForm.hidden = false;
      setStatus("Enter the hosted access token to start.", "neutral");
      setBusy(false);
    } else {
      await navigate(config.homeAddress);
    }
  } catch {
    config = { transport: "fixture", mode: "fixture" };
    elements.mode.textContent = "fixture / offline-safe";
    elements.address.readOnly = true;
    elements.address.setAttribute("aria-readonly", "true");
    await loadFixture();
    setStatus(
      "Fixture mode: no remote Gopher request is made. Run the local gateway for live TCP.",
      "neutral",
    );
    setBusy(false);
  }
  renderLibraries();
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void navigate(elements.address.value);
});

elements.back.addEventListener("click", () => {
  if (historyIndex <= 0) return;
  historyIndex -= 1;
  void navigate(history[historyIndex].address, { push: false });
});

elements.forward.addEventListener("click", () => {
  if (historyIndex >= history.length - 1) return;
  historyIndex += 1;
  void navigate(history[historyIndex].address, { push: false });
});

elements.home.addEventListener("click", () => {
  if (config.transport === "live") void navigate(config.homeAddress);
});

elements.bookmark.addEventListener("click", () => {
  if (!currentResource) return;
  const index = bookmarks.findIndex(
    ({ address }) => address === currentResource.address,
  );
  if (index >= 0) {
    bookmarks.splice(index, 1);
  } else {
    bookmarks.unshift(
      historyEntry(currentResource.address, currentResource.address),
    );
    bookmarks = bookmarks.slice(0, MAX_BOOKMARKS);
  }
  writeStored(BOOKMARK_KEY, localStore, bookmarks);
  renderLibraries();
});

elements.rawToggle.addEventListener("click", () => {
  includeRaw = !includeRaw;
  elements.rawToggle.setAttribute("aria-pressed", String(includeRaw));
  elements.rawToggle.textContent = includeRaw ? "Raw on" : "Raw off";
  if (config.transport === "live" && currentResource) {
    void navigate(currentResource.address, { push: false });
  }
});

elements.export.addEventListener("click", () => {
  if (!currentResource) return;
  const data = `${JSON.stringify(currentResource, null, 2)}\n`;
  downloadBlob(
    new Blob([data], { type: "application/json" }),
    `${safeFilename(currentResource.target?.host ?? "gopher")}-response.json`,
  );
});

elements.clearHistory.addEventListener("click", () => {
  history = currentResource
    ? [historyEntry(currentResource.address, currentResource.address)]
    : [];
  historyIndex = history.length - 1;
  writeStored(HISTORY_KEY, sessionStore, history);
  renderLibraries();
});

elements.clearBookmarks.addEventListener("click", () => {
  bookmarks = [];
  writeStored(BOOKMARK_KEY, localStore, bookmarks);
  renderLibraries();
});

elements.accessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  accessToken = elements.accessToken.value;
  try {
    sessionStore.setItem(TOKEN_KEY, accessToken);
  } catch {
    // The token remains available in memory for this page.
  }
  elements.accessToken.value = "";
  elements.accessForm.hidden = true;
  void navigate(config.homeAddress);
});

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = elements.searchQuery.value;
  if (!pendingSearchAddress || query.length === 0) return;
  elements.searchQuery.value = "";
  const target = pendingSearchAddress;
  pendingSearchAddress = null;
  void navigate(target, { query });
});

elements.searchCancel.addEventListener("click", () => {
  pendingSearchAddress = null;
  elements.searchQuery.value = "";
  elements.searchForm.hidden = true;
});

await configure();

if ("serviceWorker" in navigator) {
  try {
    await navigator.serviceWorker.register("./sw.js?v=3.0.0", {
      scope: "./",
      updateViaCache: "none",
    });
  } catch {
    // Live fetching and the committed fixture do not depend on installation.
  }
}
