import { readFile, stat } from "node:fs/promises";

const root = new URL("../site/", import.meta.url);
const repositoryRoot = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const styles = await readFile(new URL("styles.css", root), "utf8");
const app = await readFile(new URL("app.mjs", root), "utf8");
const serviceWorker = await readFile(new URL("sw.js", root), "utf8");
const packageMetadata = JSON.parse(await readFile(new URL("package.json", repositoryRoot), "utf8"));
const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));
const expectedCsp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const socialPreviewUrl = "https://ejupi-djenis30.github.io/Dig/assets/social-preview.png";
for (const fragment of ["styles.css", "app.mjs", "protocol.mjs", "manifest.webmanifest", "sw.js", "assets/dig-mark.svg", "assets/dig-mark-192.png", "assets/dig-mark-512.png", "assets/demo.mp4", "assets/social-preview.png", "fixtures/root.txt"]) {
  await stat(new URL(fragment, root));
}
for (const required of ['lang="en"', "<title>", "<main", "aria-label", "Fixture mode", 'rel="manifest"', 'rel="apple-touch-icon" href="assets/dig-mark-192.png"', "readonly", '<meta name="referrer" content="no-referrer" />', 'http-equiv="Content-Security-Policy"', `content="${expectedCsp}"`, `property="og:image" content="${socialPreviewUrl}"`, 'property="og:image:width" content="1200"', 'property="og:image:height" content="675"', "property=\"og:image:alt\"", 'name="twitter:card" content="summary_large_image"', `name="twitter:image" content="${socialPreviewUrl}"`, 'name="twitter:image:alt"']) {
  if (!html.includes(required)) throw new Error(`index.html is missing ${required}`);
}
const skipLink = '<a class="skip-link" href="#main-content">Skip to content</a>';
if (!html.includes(skipLink)) throw new Error("index.html is missing the skip link.");
if (!html.includes('<main id="main-content" tabindex="-1">')) {
  throw new Error("The skip-link target must be the focusable main landmark.");
}
if (html.indexOf(skipLink) > html.indexOf('<header class="header">')) {
  throw new Error("The skip link must appear before the repeated header.");
}
for (const required of [".skip-link {", ".skip-link:focus-visible {"]) {
  if (!styles.includes(required)) throw new Error(`styles.css is missing ${required}`);
}
const releaseVersion = packageMetadata.version;
if (!/^\d+\.\d+\.\d+$/.test(releaseVersion)) throw new Error("package.json needs a stable semantic version.");
for (const asset of ["styles.css", "app.mjs"]) {
  if (!html.includes(`${asset}?v=${releaseVersion}`)) {
    throw new Error(`index.html must cache-bust ${asset} with package version ${releaseVersion}.`);
  }
}
if (!app.includes(`./sw.js?v=${releaseVersion}`)) {
  throw new Error(`app.mjs must register the service worker with package version ${releaseVersion}.`);
}
if (!serviceWorker.includes(`\`${'${CACHE_PREFIX}'}v${releaseVersion}\``)) {
  throw new Error(`sw.js cache name must include package version ${releaseVersion}.`);
}
for (const asset of ["styles.css", "app.mjs"]) {
  if (!serviceWorker.includes(`./${asset}?v=${releaseVersion}`)) {
    throw new Error(`sw.js must precache ${asset} with package version ${releaseVersion}.`);
  }
}
if (/caches\.match\(request\)\.then/u.test(serviceWorker)) {
  throw new Error("Static assets must prefer the network so deployed fixes are not hidden by a stale cache.");
}
const requiredRasterIcons = new Map([
  ["192x192", "assets/dig-mark-192.png"],
  ["512x512", "assets/dig-mark-512.png"],
]);
for (const [sizes, src] of requiredRasterIcons) {
  const icon = manifest.icons?.find((candidate) => candidate.src === src);
  if (!icon || icon.sizes !== sizes || icon.type !== "image/png") {
    throw new Error(`Manifest is missing the ${sizes} PNG install icon.`);
  }

  const iconBytes = await readFile(new URL(src, root));
  const expectedSize = Number.parseInt(sizes, 10);
  if (
    iconBytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    iconBytes.readUInt32BE(16) !== expectedSize ||
    iconBytes.readUInt32BE(20) !== expectedSize
  ) {
    throw new Error(`${src} must be a ${sizes} PNG image.`);
  }
}
const socialPreview = await readFile(new URL("assets/social-preview.png", root));
if (socialPreview.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
  throw new Error("Social preview must be a PNG image.");
}
if (socialPreview.readUInt32BE(16) !== 1_200 || socialPreview.readUInt32BE(20) !== 675) {
  throw new Error("Social preview must be exactly 1200 by 675 pixels.");
}
if (html.includes("frame-ancestors")) throw new Error("frame-ancestors is not supported in a meta CSP.");
if (html.includes("http://")) throw new Error("Public site contains an insecure HTTP URL.");
if (/(?:src|href)="\//.test(html)) throw new Error("Assets must remain relative for project Pages.");
console.log("DIG site validation passed.");
