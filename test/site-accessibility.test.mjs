import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const siteRoot = new URL("../site/", import.meta.url);
const repositoryRoot = new URL("../", import.meta.url);

test("the skip link precedes the header and targets the focusable main landmark", async () => {
  const html = await readFile(new URL("index.html", siteRoot), "utf8");
  const skipLink = '<a class="skip-link" href="#main-content">Skip to content</a>';

  assert.ok(html.includes(skipLink));
  assert.ok(html.includes('<main id="main-content" tabindex="-1">'));
  assert.ok(html.indexOf(skipLink) < html.indexOf('<header class="header">'));
});

test("the skip link has a visible keyboard-focus state and a usable target size", async () => {
  const styles = await readFile(new URL("styles.css", siteRoot), "utf8");

  assert.match(styles, /\.skip-link\s*\{[^}]*min-height:\s*2\.75rem;/s);
  assert.match(styles, /\.skip-link:focus-visible\s*\{[^}]*transform:\s*translateY\(0\);/s);
});

test("the packet side nodes keep symmetric spacing at intermediate widths", async () => {
  const styles = await readFile(new URL("styles.css", siteRoot), "utf8");

  assert.match(
    styles,
    /@media \(min-width: 921px\) and \(max-width: 1100px\) \{\s*\.packet-node-left,\s*\.packet-node-right \{ padding-inline: \.55rem; \}\s*\}/u,
  );
});

test("site assets and the service-worker cache roll over with every release", async () => {
  const [html, app, serviceWorker, packageMetadata, packageLock, changelog] = await Promise.all([
    readFile(new URL("index.html", siteRoot), "utf8"),
    readFile(new URL("app.mjs", siteRoot), "utf8"),
    readFile(new URL("sw.js", siteRoot), "utf8"),
    readFile(new URL("package.json", repositoryRoot), "utf8").then(JSON.parse),
    readFile(new URL("package-lock.json", repositoryRoot), "utf8").then(JSON.parse),
    readFile(new URL("CHANGELOG.md", repositoryRoot), "utf8"),
  ]);
  const version = packageMetadata.version;

  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageLock.version, version);
  assert.equal(packageLock.packages[""].version, version);
  assert.ok(changelog.includes(`## ${version} —`));
  assert.ok(html.includes(`styles.css?v=${version}`));
  assert.ok(html.includes(`app.mjs?v=${version}`));
  assert.ok(app.includes(`./protocol.mjs?v=${version}`));
  assert.ok(app.includes(`fixtures/root.txt?v=${version}`));
  assert.ok(app.includes(`./sw.js?v=${version}`));
  assert.ok(serviceWorker.includes(`\`${'${CACHE_PREFIX}'}v${version}\``));
  assert.ok(serviceWorker.includes(`./styles.css?v=${version}`));
  assert.ok(serviceWorker.includes(`./app.mjs?v=${version}`));
  assert.ok(serviceWorker.includes(`./protocol.mjs?v=${version}`));
  assert.ok(serviceWorker.includes(`./fixtures/root.txt?v=${version}`));
  assert.doesNotMatch(serviceWorker, /caches\.match\(request\)\.then/u);
});

test("project Pages discovery and security documents stay canonical", async () => {
  const [robots, sitemap, security] = await Promise.all([
    readFile(new URL("robots.txt", siteRoot), "utf8"),
    readFile(new URL("sitemap.xml", siteRoot), "utf8"),
    readFile(new URL(".well-known/security.txt", siteRoot), "utf8"),
  ]);

  assert.equal(
    robots,
    [
      "User-agent: *",
      "Allow: /Dig/",
      "Sitemap: https://ejupi-djenis30.github.io/Dig/sitemap.xml",
      "",
    ].join("\n"),
  );
  assert.match(sitemap, /<loc>https:\/\/ejupi-djenis30\.github\.io\/Dig\/<\/loc>/u);
  assert.match(
    security,
    /^Contact: https:\/\/github\.com\/ejupi-djenis30\/Dig\/security\/advisories\/new$/mu,
  );
  assert.match(
    security,
    /^Canonical: https:\/\/ejupi-djenis30\.github\.io\/Dig\/\.well-known\/security\.txt$/mu,
  );
  assert.match(security, /^Policy: https:\/\/github\.com\/ejupi-djenis30\/Dig\/security\/policy$/mu);
  assert.match(security, /^Preferred-Languages: en$/mu);
  assert.doesNotMatch(security, /mailto:|@[A-Za-z0-9.-]+/u);
  const expiration = security.match(/^Expires:\s*(\S+)$/mu)?.[1];
  assert.ok(expiration);
  assert.ok(Date.parse(expiration) > Date.now());
});

test("public project surfaces use collective attribution", async () => {
  const [readme, license, html] = await Promise.all([
    readFile(new URL("README.md", repositoryRoot), "utf8"),
    readFile(new URL("LICENSE", repositoryRoot), "utf8"),
    readFile(new URL("index.html", siteRoot), "utf8"),
  ]);

  assert.doesNotMatch(readme, /prototype by /iu);
  assert.doesNotMatch(html, /Original prototype:/u);
  assert.match(readme, /Ejupi Labs and DIG contributors/u);
  assert.match(license, /Ejupi Labs and DIG contributors/u);
  assert.match(html, /Ejupi Labs and DIG contributors built both the prototype and the current implementation/u);
  assert.match(html, />DIG contributors <span aria-hidden="true">↗<\/span><\/a>/u);
});

test("mobile app metadata and controls are production-ready", async () => {
  const [html, app, styles, manifestSource, privacy] = await Promise.all([
    readFile(new URL("index.html", siteRoot), "utf8"),
    readFile(new URL("app.mjs", siteRoot), "utf8"),
    readFile(new URL("styles.css", siteRoot), "utf8"),
    readFile(new URL("manifest.webmanifest", siteRoot), "utf8"),
    readFile(new URL("PRIVACY.md", repositoryRoot), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.match(html, /viewport-fit=cover/u);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/u);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="assets\/dig-mark-180\.png"/u);
  assert.match(html, /data-resource-tab/u);
  assert.match(html, /data-trace-tab/u);
  assert.match(app, /function bindMobilePanelTab\(tab, panel\)/u);
  assert.match(app, /tab\.addEventListener\("pointerup"/u);
  assert.match(app, /tab\.addEventListener\("click", activate\)/u);
  assert.match(html, /href="https:\/\/github\.com\/ejupi-djenis30\/Dig\/blob\/main\/PRIVACY\.md"/u);
  assert.match(styles, /env\(safe-area-inset-top\)/u);
  assert.match(styles, /@media \(display-mode: standalone\)/u);
  assert.match(styles, /\.browser-bar input \{ font-size: 1rem; \}/u);
  assert.equal(manifest.id, "./");
  assert.equal(manifest.start_url, "./#explorer");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "any");
  assert.ok(manifest.icons.some(({ purpose }) => purpose === "maskable"));
  assert.ok(
    manifest.screenshots.some(
      ({ src, sizes, form_factor: formFactor }) =>
        src === "assets/screenshot-mobile.png" &&
        sizes === "390x844" &&
        formFactor === "narrow",
    ),
  );
  assert.match(privacy, /Gopher is a plaintext protocol/u);
});

test("interactive controls fail safe during application startup", async () => {
  const html = await readFile(new URL("index.html", siteRoot), "utf8");

  assert.match(html, /<input id="address"[^>]*disabled data-address/u);
  assert.match(html, /<button type="submit" data-go disabled>Open<\/button>/u);
  assert.match(html, /aria-label="Back" data-back disabled/u);
  assert.match(html, /aria-label="Forward" data-forward disabled/u);
  assert.match(html, /data-home disabled/u);
  assert.match(html, /data-raw-toggle aria-pressed="false" disabled/u);
});
