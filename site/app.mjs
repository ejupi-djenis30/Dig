import { itemType, parseGopherUrl, parseMenu } from "./protocol.mjs";

const menu = document.querySelector("[data-menu]");
const form = document.querySelector("[data-address-form]");
const address = document.querySelector("[data-address]");
const fixtureStatus = document.querySelector("[data-fixture-status]");
const traceAnnouncement = document.querySelector("[data-trace-announcement]");
const fields = {
  count: document.querySelector("[data-count]"),
  type: document.querySelector("[data-type]"),
  typeName: document.querySelector("[data-type-name]"),
  label: document.querySelector("[data-label]"),
  selector: document.querySelector("[data-selector]"),
  host: document.querySelector("[data-host]"),
  port: document.querySelector("[data-port]"),
  raw: document.querySelector("[data-raw]"),
};

let entries = [];
let fixtureError = null;
try {
  const response = await fetch("fixtures/root.txt");
  if (!response.ok) throw new Error(`Fixture request returned HTTP ${response.status}.`);
  entries = parseMenu(await response.text());
} catch (error) {
  fixtureError = error;
}

function inspect(entry, button) {
  document.querySelectorAll(".menu-item").forEach((item) => item.removeAttribute("aria-current"));
  button?.setAttribute("aria-current", "true");
  const kind = itemType(entry.type);
  fields.type.textContent = kind.icon;
  fields.typeName.textContent = `${entry.type} · ${kind.label}`;
  fields.label.textContent = entry.label;
  fields.selector.textContent = entry.selector || "(root)";
  fields.host.textContent = entry.host || "—";
  fields.port.textContent = entry.port || "—";
  fields.raw.textContent = entry.raw;
  if (traceAnnouncement) {
    traceAnnouncement.textContent = `${entry.label}. ${kind.label}. Selector ${entry.selector || "root"}, host ${entry.host || "not provided"}, port ${entry.port || "not provided"}.`;
  }
}

function render() {
  if (fixtureError) {
    menu.textContent = "The bundled recording could not be loaded. Reload the page to try again.";
    fields.count.textContent = "Unavailable";
    fixtureStatus.textContent = `Fixture unavailable: ${fixtureError.message}`;
    form.querySelector("button")?.setAttribute("disabled", "");
    return;
  }

  const fragment = document.createDocumentFragment();
  entries.forEach((entry, index) => {
    const kind = itemType(entry.type);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-item";
    const icon = document.createElement("span");
    icon.textContent = kind.icon;
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = entry.label;
    const meta = document.createElement("small");
    meta.textContent = entry.valid ? `${entry.host}:${entry.port}` : "Malformed line";
    copy.append(title, meta);
    const arrow = document.createElement("i");
    arrow.textContent = "↗";
    arrow.setAttribute("aria-hidden", "true");
    button.append(icon, copy, arrow);
    button.addEventListener("click", () => inspect(entry, button));
    fragment.append(button);
    if (index === 0) queueMicrotask(() => inspect(entry, button));
  });
  menu.replaceChildren(fragment);
  fields.count.textContent = `${entries.length} items`;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  parseGopherUrl(address.value);
  render();
  menu.querySelector("button")?.focus();
  fixtureStatus.textContent = "The local Gopher recording was replayed. No remote request was made.";
});

render();

if ("serviceWorker" in navigator) {
  try {
    await navigator.serviceWorker.register("./sw.js?v=2.1.0", { scope: "./", updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    fixtureStatus.textContent += " The explorer is ready for a future offline visit.";
  } catch {
    // The protocol explorer remains fully functional without offline installation.
  }
}
