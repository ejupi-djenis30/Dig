import { readFile, stat } from "node:fs/promises";

const root = new URL("../site/", import.meta.url);
const repositoryRoot = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const styles = await readFile(new URL("styles.css", root), "utf8");
const app = await readFile(new URL("app.mjs", root), "utf8");
const serviceWorker = await readFile(new URL("sw.js", root), "utf8");
const packageMetadata = JSON.parse(await readFile(new URL("package.json", repositoryRoot), "utf8"));
const packageLock = JSON.parse(await readFile(new URL("package-lock.json", repositoryRoot), "utf8"));
const changelog = await readFile(new URL("CHANGELOG.md", repositoryRoot), "utf8");
const privacy = await readFile(new URL("PRIVACY.md", repositoryRoot), "utf8");
const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));
const expectedCsp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const socialPreviewUrl = "https://ejupi-djenis30.github.io/Dig/assets/social-preview.png";
for (const fragment of ["styles.css", "app.mjs", "protocol.mjs", "manifest.webmanifest", "sw.js", "assets/dig-mark.svg", "assets/dig-mark-maskable.svg", "assets/dig-mark-180.png", "assets/dig-mark-192.png", "assets/dig-mark-512.png", "assets/screenshot-mobile.png", "assets/social-preview.png", "fixtures/root.txt"]) {
  await stat(new URL(fragment, root));
}
for (const required of ['lang="en"', "<title>", "<main", "aria-label", "Run DIG locally", "data-security-banner", "data-history-list", "data-bookmark-list", "data-resource-tab", "data-trace-tab", "data-install", "viewport-fit=cover", 'name="apple-mobile-web-app-capable" content="yes"', 'name="apple-mobile-web-app-status-bar-style" content="black-translucent"', 'rel="manifest"', 'rel="apple-touch-icon" sizes="180x180" href="assets/dig-mark-180.png"', "readonly", "PRIVACY.md", '<meta name="referrer" content="no-referrer" />', 'http-equiv="Content-Security-Policy"', `content="${expectedCsp}"`, `property="og:image" content="${socialPreviewUrl}"`, 'property="og:image:width" content="1200"', 'property="og:image:height" content="675"', "property=\"og:image:alt\"", 'name="twitter:card" content="summary_large_image"', `name="twitter:image" content="${socialPreviewUrl}"`, 'name="twitter:image:alt"']) {
  if (!html.includes(required)) throw new Error(`index.html is missing ${required}`);
}
const skipLink = '<a class="skip-link" href="#main-content">Skip to content</a>';
if (!html.includes(skipLink)) throw new Error("index.html is missing the skip link.");
if (!html.includes('<main id="main-content" tabindex="-1">')) {
  throw new Error("The skip-link target must be the focusable main landmark.");
}
if (!privacy.includes("DIG Privacy Notice") || !privacy.includes("Effective date: July 26, 2026")) {
  throw new Error("PRIVACY.md must contain the current DIG privacy notice.");
}
if (/<video\b/iu.test(html)) {
  throw new Error("The project page must not embed a landing-page video.");
}
if (html.indexOf(skipLink) > html.indexOf('<header class="header">')) {
  throw new Error("The skip link must appear before the repeated header.");
}
for (const required of [".skip-link {", ".skip-link:focus-visible {", "env(safe-area-inset-top)", "@media (display-mode: standalone)", ".mobile-panel-tabs {"]) {
  if (!styles.includes(required)) throw new Error(`styles.css is missing ${required}`);
}
const releaseVersion = packageMetadata.version;
if (!/^\d+\.\d+\.\d+$/.test(releaseVersion)) throw new Error("package.json needs a stable semantic version.");
if (packageLock.version !== releaseVersion || packageLock.packages?.[""]?.version !== releaseVersion) {
  throw new Error(`package-lock.json must match package version ${releaseVersion}.`);
}
if (!changelog.includes(`## ${releaseVersion} —`)) {
  throw new Error(`CHANGELOG.md must document package version ${releaseVersion}.`);
}
for (const asset of ["styles.css", "app.mjs"]) {
  if (!html.includes(`${asset}?v=${releaseVersion}`)) {
    throw new Error(`index.html must cache-bust ${asset} with package version ${releaseVersion}.`);
  }
}
for (const asset of ["protocol.mjs", "fixtures/root.txt"]) {
  const reference = asset === "protocol.mjs" ? `./${asset}?v=${releaseVersion}` : `${asset}?v=${releaseVersion}`;
  if (!app.includes(reference)) {
    throw new Error(`app.mjs must cache-bust ${asset} with package version ${releaseVersion}.`);
  }
}
if (!app.includes(`./sw.js?v=${releaseVersion}`)) {
  throw new Error(`app.mjs must register the service worker with package version ${releaseVersion}.`);
}
for (const required of ["beforeinstallprompt", "appinstalled", "controllerchange", "SKIP_WAITING", "setMobilePanel"]) {
  if (!app.includes(required)) throw new Error(`app.mjs is missing ${required}`);
}
if (!serviceWorker.includes(`\`${'${CACHE_PREFIX}'}v${releaseVersion}\``)) {
  throw new Error(`sw.js cache name must include package version ${releaseVersion}.`);
}
for (const asset of ["styles.css", "app.mjs", "protocol.mjs", "fixtures/root.txt"]) {
  if (!serviceWorker.includes(`./${asset}?v=${releaseVersion}`)) {
    throw new Error(`sw.js must precache ${asset} with package version ${releaseVersion}.`);
  }
}
for (const asset of ["assets/dig-mark-180.png", "assets/dig-mark-192.png", "assets/dig-mark-512.png", "assets/dig-mark-maskable.svg"]) {
  if (!serviceWorker.includes(`./${asset}`)) {
    throw new Error(`sw.js must precache ${asset}.`);
  }
}
if (!serviceWorker.includes('event.data?.type === "SKIP_WAITING"')) {
  throw new Error("sw.js must expose an explicit update activation message.");
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
const appleTouchIcon = await readFile(new URL("assets/dig-mark-180.png", root));
if (
  appleTouchIcon.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
  appleTouchIcon.readUInt32BE(16) !== 180 ||
  appleTouchIcon.readUInt32BE(20) !== 180
) {
  throw new Error("assets/dig-mark-180.png must be a 180x180 PNG image.");
}
if (
  manifest.id !== "./" ||
  manifest.start_url !== "./#explorer" ||
  manifest.scope !== "./" ||
  manifest.display !== "standalone" ||
  manifest.lang !== "en" ||
  manifest.dir !== "ltr" ||
  manifest.orientation !== "any" ||
  manifest.prefer_related_applications !== false
) {
  throw new Error("The web app manifest is missing its stable mobile app contract.");
}
const maskableIcon = manifest.icons?.find(
  (candidate) => candidate.src === "assets/dig-mark-maskable.svg",
);
if (
  !maskableIcon ||
  maskableIcon.type !== "image/svg+xml" ||
  maskableIcon.sizes !== "any" ||
  maskableIcon.purpose !== "maskable"
) {
  throw new Error("The manifest needs a dedicated maskable SVG icon.");
}
const maskableSource = await readFile(new URL(maskableIcon.src, root), "utf8");
if (!maskableSource.includes('<rect width="64" height="64" fill="#d8ff3e"/>')) {
  throw new Error("The maskable icon must use an opaque full-bleed brand background.");
}
if (!manifest.shortcuts?.some((shortcut) => shortcut.url === "./#explorer")) {
  throw new Error("The manifest needs an Explorer app shortcut.");
}
const mobileScreenshot = manifest.screenshots?.find(
  (candidate) => candidate.src === "assets/screenshot-mobile.png",
);
if (
  !mobileScreenshot ||
  mobileScreenshot.sizes !== "390x844" ||
  mobileScreenshot.type !== "image/png" ||
  mobileScreenshot.form_factor !== "narrow"
) {
  throw new Error("The manifest needs its 390x844 narrow mobile screenshot.");
}
const mobileScreenshotBytes = await readFile(new URL(mobileScreenshot.src, root));
if (
  mobileScreenshotBytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
  mobileScreenshotBytes.readUInt32BE(16) !== 390 ||
  mobileScreenshotBytes.readUInt32BE(20) !== 844
) {
  throw new Error("The mobile install screenshot must be a 390x844 PNG image.");
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
