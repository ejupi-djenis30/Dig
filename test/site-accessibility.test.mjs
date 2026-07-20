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
  assert.ok(app.includes(`./sw.js?v=${version}`));
  assert.ok(serviceWorker.includes(`\`${'${CACHE_PREFIX}'}v${version}\``));
  assert.ok(serviceWorker.includes(`./styles.css?v=${version}`));
  assert.ok(serviceWorker.includes(`./app.mjs?v=${version}`));
  assert.doesNotMatch(serviceWorker, /caches\.match\(request\)\.then/u);
});
