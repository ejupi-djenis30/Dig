import {
  itemType,
  parseGopherUrl,
  parseMenu,
  toGopherUrl,
} from "./protocol.mjs?v=3.2.0";

const BOOKMARK_KEY = "dig.bookmarks.v1";
const HISTORY_KEY = "dig.history.v1";
const TOKEN_KEY = "dig.access-token.v1";
const LIVE_TRANSPORT_KEY = "dig.live-transport.v1";
const LIVE_TRANSPORT_RETRY_MS = 3_000;
const MAX_BOOKMARKS = 50;
const MAX_HISTORY = 100;
const nativeTransport = globalThis.__DIG_NATIVE_TRANSPORT__ ?? null;

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
  connectivity: document.querySelector("[data-connectivity]"),
  install: document.querySelector("[data-install]"),
  appNotice: document.querySelector("[data-app-notice]"),
  appNoticeMessage: document.querySelector("[data-app-notice-message]"),
  appNoticeAction: document.querySelector("[data-app-notice-action]"),
  appNoticeDismiss: document.querySelector("[data-app-notice-dismiss]"),
  securityBanner: document.querySelector("[data-security-banner]"),
  accessForm: document.querySelector("[data-access-form]"),
  accessToken: document.querySelector("[data-access-token]"),
  searchForm: document.querySelector("[data-search-form]"),
  searchQuery: document.querySelector("[data-search-query]"),
  searchTarget: document.querySelector("[data-search-target]"),
  searchCancel: document.querySelector("[data-search-cancel]"),
  resource: document.querySelector("[data-resource]"),
  panelContainer: document.querySelector("[data-panel-container]"),
  resourceTab: document.querySelector("[data-resource-tab]"),
  traceTab: document.querySelector("[data-trace-tab]"),
  tracePanel: document.querySelector("[data-trace-panel]"),
  resourceHeading: document.querySelector("[data-resource-heading]"),
  count: document.querySelector("[data-count]"),
  back: document.querySelector("[data-back]"),
  forward: document.querySelector("[data-forward]"),
  home: document.querySelector("[data-home]"),
  bookmark: document.querySelector("[data-bookmark]"),
  rawToggle: document.querySelector("[data-raw-toggle]"),
  share: document.querySelector("[data-share]"),
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
let appBusy = true;
let reconnectRequested = false;
let deferredInstallPrompt = null;
let noticeAction = null;
let updateActivationRequested = false;
let reloadingForUpdate = false;
let shouldProbeLiveTransport =
  readString(LIVE_TRANSPORT_KEY, sessionStore) === "1";
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
  appBusy = busy;
  elements.app.setAttribute("aria-busy", String(busy));
  elements.app.dataset.state = busy ? "loading" : config?.transport ?? "ready";
  updateNavigationControls();
}

function hideAppNotice() {
  noticeAction = null;
  elements.appNotice.hidden = true;
  elements.appNoticeMessage.textContent = "";
  elements.appNoticeAction.hidden = true;
  elements.appNoticeAction.textContent = "";
}

function showAppNotice(message, options = {}) {
  elements.appNoticeMessage.textContent = message;
  noticeAction = typeof options.onAction === "function" ? options.onAction : null;
  elements.appNoticeAction.hidden = !noticeAction;
  elements.appNoticeAction.textContent = noticeAction
    ? options.actionLabel ?? "Continue"
    : "";
  elements.appNotice.hidden = false;
}

function setMobilePanel(panel, options = {}) {
  const nextPanel = panel === "trace" ? "trace" : "resource";
  elements.panelContainer.dataset.mobilePanel = nextPanel;
  elements.resourceTab.setAttribute(
    "aria-pressed",
    String(nextPanel === "resource"),
  );
  elements.traceTab.setAttribute(
    "aria-pressed",
    String(nextPanel === "trace"),
  );
  if (options.focus === true) {
    const target = nextPanel === "trace"
      ? elements.tracePanel
      : elements.resourceHeading;
    target.focus({ preventScroll: false });
  }
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIosDevice() {
  return (
    /iphone|ipad|ipod/iu.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function updateInstallAvailability() {
  elements.install.hidden =
    Boolean(nativeTransport) ||
    isStandalone() ||
    (!deferredInstallPrompt && !isIosDevice());
}

function canRequestResources() {
  return ["live", "native"].includes(config?.transport);
}

function updateConnectivity() {
  const offline = navigator.onLine === false;
  elements.connectivity.hidden = !offline;
  elements.connectivity.textContent = offline ? "Offline" : "Online";
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

async function shareCurrentResource() {
  if (!currentResource) return;
  const address = currentResource.address;
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({
        title: "DIG Gopher resource",
        text: address,
      });
      setStatus("Resource shared.", "success");
      return;
    }
    if (typeof navigator.clipboard?.writeText !== "function") {
      throw new Error("Sharing is not available in this browser.");
    }
    await navigator.clipboard.writeText(address);
    setStatus("Gopher address copied to the clipboard.", "success");
  } catch (error) {
    if (error.name === "AbortError") return;
    setStatus(error.message ?? "The resource could not be shared.", "error");
  }
}

function historyEntry(address, label = address) {
  return { address, label: String(label).slice(0, 160) };
}

function updateNavigationControls() {
  const authenticated = !config?.requiresAccessToken || Boolean(accessToken);
  const requestReady = canRequestResources() && authenticated;
  const hasResource = currentResource !== null;

  elements.address.disabled = config === null;
  elements.go.disabled = appBusy || !requestReady;
  elements.back.disabled = appBusy || !requestReady || historyIndex <= 0;
  elements.forward.disabled =
    appBusy || !requestReady || historyIndex >= history.length - 1;
  elements.home.disabled = appBusy || !requestReady;
  elements.bookmark.disabled = appBusy || !requestReady || !hasResource;
  elements.rawToggle.disabled = appBusy || !requestReady || !hasResource;
  elements.share.disabled = appBusy || !hasResource;
  elements.export.disabled = appBusy || !hasResource;
  elements.clearHistory.disabled = appBusy || history.length === 0;
  elements.clearBookmarks.disabled = appBusy || bookmarks.length === 0;
  elements.app
    .querySelectorAll("[data-location-button]")
    .forEach((button) => {
      button.disabled = appBusy || !requestReady;
    });

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
    button.dataset.locationButton = "";
    button.textContent = entry.label || entry.address;
    const address = document.createElement("code");
    address.textContent = entry.address;
    button.append(address);
    button.addEventListener("click", () => {
      if (!canRequestResources() || appBusy) return;
      void navigate(
        entry.address,
        ordered ? { push: false, historyIndex: index } : { push: true },
      );
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

function clearTrace(message = "No resource selected") {
  elements.trace.type.textContent = "—";
  elements.trace.typeName.textContent = "—";
  elements.trace.label.textContent = message;
  elements.trace.selector.textContent = "—";
  elements.trace.host.textContent = "—";
  elements.trace.port.textContent = "—";
  elements.trace.bytes.textContent = "—";
  elements.trace.sha.textContent = "—";
  elements.trace.raw.textContent = "Raw bytes are opt-in.";
  elements.traceAnnouncement.textContent = message;
}

function renderErrorState(error, retry, options = {}) {
  currentResource = null;
  pendingSearchAddress = null;
  elements.searchForm.hidden = true;
  elements.resourceHeading.textContent = options.heading ?? "REQUEST FAILED";
  elements.count.textContent = error.code ?? options.count ?? "Error";

  const container = document.createElement("div");
  container.className = "error-resource";
  const message = document.createElement("p");
  message.textContent = error.message ?? "DIG could not load this resource.";
  container.append(message);
  if (typeof retry === "function") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Retry";
    button.addEventListener("click", retry);
    container.append(button);
  }
  elements.resource.replaceChildren(container);
  clearTrace("No current resource");
  setMobilePanel("resource");
  renderLibraries();
  if (options.focus !== false) {
    elements.resourceHeading.focus({ preventScroll: false });
  }
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
    config?.transport === "fixture"
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
    if (!canRequestResources()) {
      setMobilePanel("trace", { focus: true });
      return;
    }
    if (entry.requiresQuery && entry.url) {
      pendingSearchAddress = entry.url;
      elements.searchTarget.textContent = `Query ${entry.label} at ${entry.host}:${entry.port}.`;
      elements.searchForm.hidden = false;
      elements.searchQuery.focus();
    } else if (entry.requestable && entry.url) {
      void navigate(entry.url);
    } else {
      setMobilePanel("trace", { focus: true });
    }
  });
  return button;
}

function renderMenu(resource) {
  elements.resourceHeading.textContent = "GOPHER MENU";
  elements.count.textContent = `${resource.entries.length} items`;
  if (resource.entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "resource-empty-state";
    empty.textContent = "This Gopher menu is empty.";
    elements.resource.replaceChildren(empty);
    clearTrace("Empty Gopher menu");
    return;
  }

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
  const first = elements.resource.querySelector(".menu-item");
  first.setAttribute("aria-current", "true");
  setTrace(resource.entries[0]);
}

function renderText(resource) {
  elements.resourceHeading.textContent = "TEXT RESPONSE";
  elements.count.textContent = `${resource.byteLength} bytes`;
  if (resource.text.length === 0) {
    const empty = document.createElement("p");
    empty.className = "resource-empty-state";
    empty.textContent = "This text response is empty.";
    elements.resource.replaceChildren(empty);
    return;
  }
  const text = document.createElement("pre");
  text.className = "text-resource";
  text.textContent = resource.text;
  elements.resource.replaceChildren(text);
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
  button.addEventListener("click", async () => {
    if (nativeTransport?.saveFile) {
      button.disabled = true;
      try {
        const result = await nativeTransport.saveFile({
          data: resource.data,
          mediaType: resource.mediaType,
          suggestedFilename: safeFilename(resource.suggestedFilename),
        });
        setStatus(
          result.saved ? "The file was saved." : "File save cancelled.",
          result.saved ? "success" : "neutral",
        );
      } catch (error) {
        setStatus(error.message ?? "DIG could not save the file.", "error");
      } finally {
        button.disabled = false;
      }
      return;
    }

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
  setMobilePanel("resource");
  if (resource.kind === "menu") renderMenu(resource);
  if (resource.kind === "text") renderText(resource);
  if (resource.kind === "binary") renderBinary(resource);
  if (resource.kind === "external") renderExternal(resource);
  if (resource.kind !== "menu") setTrace(resource);
  renderLibraries();
}

async function fetchResource(address, query, signal) {
  if (config?.transport === "native" && nativeTransport) {
    return nativeTransport.fetchResource({
      address,
      includeRaw,
      query,
      signal,
    });
  }

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
  if (!canRequestResources()) {
    setStatus(
      "Fixture mode is read-only. Start a same-origin DIG gateway for live requests.",
      "neutral",
    );
    return false;
  }
  navigationController?.abort();
  const controller = new AbortController();
  navigationController = controller;
  setBusy(true);
  setStatus("Opening the Gopher resource…", "neutral");
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
      if (Number.isInteger(options.historyIndex)) {
        historyIndex = options.historyIndex;
      }
      renderLibraries();
    }
    if (options.focus !== false) {
      elements.resourceHeading.focus({ preventScroll: false });
    }
    setStatus(
      `Fetched ${resource.byteLength} bytes in ${resource.durationMs} ms. SHA-256 ${resource.sha256 ?? "not applicable"}.`,
      "success",
    );
    return true;
  } catch (error) {
    if (error.name === "AbortError") return false;
    const authenticationRequired = error.code === "AUTH_REQUIRED";
    if (authenticationRequired) {
      accessToken = "";
      try {
        sessionStore.setItem(TOKEN_KEY, "");
      } catch {
        // The in-memory token has still been cleared.
      }
      elements.accessForm.hidden = false;
    }
    renderErrorState(
      error,
      () => void navigate(address, options),
      { focus: options.focus !== false && !authenticationRequired },
    );
    if (authenticationRequired) elements.accessToken.focus();
    setStatus(error.message, "error");
    return false;
  } finally {
    if (navigationController === controller) {
      navigationController = null;
      setBusy(false);
    }
  }
}

async function loadFixture() {
  const response = await fetch("fixtures/root.txt?v=3.2.0");
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

async function configure({ preserveFixtureOnFailure = false } = {}) {
  const preserveExistingFixture =
    preserveFixtureOnFailure &&
    config?.transport === "fixture" &&
    currentResource !== null;

  setBusy(true);
  setStatus("Detecting the available transport…", "neutral");
  try {
    let detectedConfig;
    if (nativeTransport) {
      detectedConfig = await nativeTransport.getConfig();
    } else {
      const response = await fetch("api/config", { cache: "no-store" });
      if (!response.ok) throw new Error("The local gateway is not available.");
      detectedConfig = await response.json();
    }
    config = {
      ...detectedConfig,
      transport: nativeTransport ? "native" : "live",
    };
    shouldProbeLiveTransport = !nativeTransport;
    if (shouldProbeLiveTransport) {
      sessionStore.setItem(LIVE_TRANSPORT_KEY, "1");
    }
    elements.mode.textContent = nativeTransport
      ? `${config.mode} / direct TCP`
      : `${config.mode} / live TCP`;
    elements.address.disabled = false;
    elements.address.readOnly = false;
    elements.address.removeAttribute("aria-readonly");
    elements.securityBanner.hidden = !config.privateDestinationWarning;
    elements.securityBanner.textContent =
      config.privateDestinationWarning ?? "";
    if (config.requiresAccessToken && !accessToken) {
      elements.accessForm.hidden = false;
      renderErrorState(
        new Error("Enter the hosted access token to start."),
        null,
        { heading: "ACCESS REQUIRED", count: "Locked", focus: false },
      );
      setStatus("Enter the hosted access token to start.", "neutral");
    } else {
      elements.accessForm.hidden = true;
      await navigate(config.homeAddress, { focus: false });
    }
  } catch {
    config = { transport: "fixture", mode: "fixture" };
    elements.mode.textContent = "fixture / offline-safe";
    elements.address.disabled = false;
    elements.address.readOnly = true;
    elements.address.setAttribute("aria-readonly", "true");
    elements.securityBanner.hidden = true;
    elements.accessForm.hidden = true;

    if (preserveExistingFixture) {
      setStatus(
        "Connection restored, but the live gateway is unavailable. Offline fixture remains active.",
        "neutral",
      );
      return;
    }

    try {
      await loadFixture();
      setStatus(
        "Fixture mode: no remote Gopher request is made. Use a same-origin gateway for live TCP.",
        "neutral",
      );
    } catch (error) {
      renderErrorState(
        error,
        () => void configure(),
        { heading: "APP UNAVAILABLE", count: "Offline", focus: false },
      );
      setStatus("DIG could not load its offline fixture.", "error");
    }
  } finally {
    setBusy(false);
    renderLibraries();
    if (
      reconnectRequested &&
      config?.transport === "fixture"
    ) {
      reconnectRequested = false;
      queueMicrotask(() => void reconnectWhenOnline());
    }
  }
}

async function reconnectWhenOnline() {
  updateConnectivity();
  if (config?.transport !== "fixture") return;
  if (appBusy) {
    reconnectRequested = true;
    return;
  }
  reconnectRequested = false;
  await configure({ preserveFixtureOnFailure: true });
}

async function promptForInstall() {
  if (deferredInstallPrompt) {
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice?.outcome === "accepted") {
        setStatus("DIG installation accepted.", "success");
      }
    } catch (error) {
      setStatus(error.message ?? "DIG could not start installation.", "error");
    } finally {
      updateInstallAvailability();
    }
    return;
  }
  if (isIosDevice() && !isStandalone()) {
    showAppNotice(
      "To install DIG on iPhone or iPad, open the Share menu and choose Add to Home Screen.",
    );
  }
}

function offerServiceWorkerUpdate(worker) {
  showAppNotice("A new version of DIG is ready.", {
    actionLabel: "Update now",
    onAction: () => {
      noticeAction = null;
      elements.appNoticeAction.hidden = true;
      elements.appNoticeMessage.textContent = "Updating DIG…";
      updateActivationRequested = true;
      worker.postMessage({ type: "SKIP_WAITING" });
    },
  });
}

async function registerServiceWorker() {
  if (nativeTransport || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register(
      "./sw.js?v=3.2.0",
      { scope: "./", updateViaCache: "none" },
    );
    if (registration.waiting && navigator.serviceWorker.controller) {
      offerServiceWorkerUpdate(registration.waiting);
    }
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (
          worker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          offerServiceWorkerUpdate(worker);
        }
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!updateActivationRequested || reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void registration.update().catch(() => {});
      }
    });
    return registration;
  } catch {
    return null;
  }
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void navigate(elements.address.value);
});

elements.back.addEventListener("click", () => {
  if (historyIndex <= 0 || appBusy) return;
  const nextIndex = historyIndex - 1;
  void navigate(history[nextIndex].address, {
    push: false,
    historyIndex: nextIndex,
  });
});

elements.forward.addEventListener("click", () => {
  if (historyIndex >= history.length - 1 || appBusy) return;
  const nextIndex = historyIndex + 1;
  void navigate(history[nextIndex].address, {
    push: false,
    historyIndex: nextIndex,
  });
});

elements.home.addEventListener("click", () => {
  if (canRequestResources() && !appBusy) {
    void navigate(config.homeAddress);
  }
});

elements.bookmark.addEventListener("click", () => {
  if (!canRequestResources() || !currentResource || appBusy) return;
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
  if (!canRequestResources() || !currentResource || appBusy) return;
  includeRaw = !includeRaw;
  elements.rawToggle.setAttribute("aria-pressed", String(includeRaw));
  elements.rawToggle.textContent = includeRaw ? "Raw on" : "Raw off";
  void navigate(currentResource.address, { push: false });
});

elements.share.addEventListener("click", () => {
  void shareCurrentResource();
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

function bindMobilePanelTab(tab, panel) {
  const activate = () => setMobilePanel(panel, { focus: true });
  tab.addEventListener("pointerup", (event) => {
    if (event.isPrimary && event.button === 0) activate();
  });
  tab.addEventListener("click", activate);
}

bindMobilePanelTab(elements.resourceTab, "resource");
bindMobilePanelTab(elements.traceTab, "trace");

elements.appNoticeAction.addEventListener("click", () => {
  const action = noticeAction;
  if (action) action();
});

elements.appNoticeDismiss.addEventListener("click", hideAppNotice);
elements.install.addEventListener("click", () => {
  void promptForInstall();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallAvailability();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  hideAppNotice();
  updateInstallAvailability();
  setStatus("DIG is installed and ready.", "success");
});

window.addEventListener("online", () => void reconnectWhenOnline());
window.addEventListener("offline", updateConnectivity);
window.setInterval(() => {
  if (
    shouldProbeLiveTransport &&
    config?.transport === "fixture" &&
    !appBusy &&
    document.visibilityState === "visible"
  ) {
    void reconnectWhenOnline();
  }
}, LIVE_TRANSPORT_RETRY_MS);
window.matchMedia("(display-mode: standalone)").addEventListener?.(
  "change",
  updateInstallAvailability,
);

updateConnectivity();
updateInstallAvailability();
void registerServiceWorker();
await configure();
