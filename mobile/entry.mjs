import { registerPlugin } from "@capacitor/core";

import { createNativeTransport } from "./native-transport.mjs";

const DigGopher = registerPlugin("DigGopher");

Object.defineProperty(globalThis, "__DIG_NATIVE_TRANSPORT__", {
  configurable: false,
  enumerable: false,
  writable: false,
  value: createNativeTransport(DigGopher),
});

document.documentElement.dataset.runtime = "android";

await import("../site/app.mjs");
