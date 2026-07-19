import { itemType, parseGopherUrl, parseMenu } from "./protocol.mjs";

const menu = document.querySelector("[data-menu]");
const form = document.querySelector("[data-address-form]");
const address = document.querySelector("[data-address]");
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

const fixture = await fetch("fixtures/root.txt").then((response) => {
  if (!response.ok) throw new Error("The local fixture could not be loaded.");
  return response.text();
});
const entries = parseMenu(fixture);

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
}

function render() {
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
  try {
    parseGopherUrl(address.value);
    address.setCustomValidity("");
    address.value = "gopher://dig.local/1/";
    render();
  } catch (error) {
    address.setCustomValidity(error.message);
    address.reportValidity();
  }
});

address.addEventListener("input", () => address.setCustomValidity(""));
render();
