import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../site/", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
for (const fragment of ["styles.css", "app.mjs", "protocol.mjs", "manifest.webmanifest", "sw.js", "assets/dig-mark.svg", "assets/demo.mp4", "fixtures/root.txt"]) {
  await stat(new URL(fragment, root));
}
for (const required of ['lang="en"', "<title>", "<main", "aria-label", "Fixture mode", 'rel="manifest"', "readonly"]) {
  if (!html.includes(required)) throw new Error(`index.html is missing ${required}`);
}
if (html.includes("http://")) throw new Error("Public site contains an insecure HTTP URL.");
if (/(?:src|href)="\//.test(html)) throw new Error("Assets must remain relative for project Pages.");
console.log("DIG site validation passed.");
