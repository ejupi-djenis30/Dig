import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildAndroidWeb } from "../scripts/build-android-web.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const repositoryPath = fileURLToPath(repositoryRoot);

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

test("Android bundle removes Source while the public site keeps it", async () => {
  await buildAndroidWeb();
  const [
    publicIndex,
    publicFixture,
    androidIndex,
    androidFixture,
    androidStyles,
  ] = await Promise.all([
    readFile(new URL("site/index.html", repositoryRoot), "utf8"),
    readFile(new URL("site/fixtures/root.txt", repositoryRoot), "utf8"),
    readFile(new URL("dist/android/index.html", repositoryRoot), "utf8"),
    readFile(new URL("dist/android/fixtures/root.txt", repositoryRoot), "utf8"),
    readFile(new URL("dist/android/styles.css", repositoryRoot), "utf8"),
  ]);

  assert.match(publicIndex, /android-exclude:source:start/u);
  assert.match(publicIndex, /class="github-link"[^>]*>Source/u);
  assert.match(publicFixture, /hProject source\tURL:https:\/\/github\.com\//u);
  assert.doesNotMatch(androidIndex, /android-exclude:source/u);
  assert.doesNotMatch(androidIndex, /class="github-link"/u);
  assert.doesNotMatch(androidIndex, />Source\s*</u);
  assert.doesNotMatch(androidFixture, /Project source|github\.com/iu);
  assert.match(androidIndex, /data-runtime="android"/u);
  assert.match(
    androidStyles,
    /html\[data-runtime="android"\] \.header > nav \{ display: none; \}/u,
  );

  for (const path of await filesUnder(resolve(repositoryPath, "dist", "android"))) {
    const contents = await readFile(path);
    assert.equal(
      contents.includes(Buffer.from("https://github.com/ejupi-djenis30/Dig")),
      false,
      `Android asset still contains the repository Source URL: ${path}`,
    );
  }
});

test("Capacitor production config uses only local secure assets", async () => {
  const config = JSON.parse(
    await readFile(new URL("capacitor.config.json", repositoryRoot), "utf8"),
  );

  assert.equal(config.appId, "com.ejupilabs.dig");
  assert.equal(config.appName, "DIG");
  assert.equal(config.webDir, "dist/android");
  assert.equal(config.loggingBehavior, "none");
  assert.equal(config.android.allowMixedContent, false);
  assert.equal(config.android.webContentsDebuggingEnabled, false);
  assert.equal(config.server.cleartext, false);
  assert.equal(config.server.url, undefined);
  assert.equal(config.server.allowNavigation, undefined);
});

test("Android release tooling pins signing, source binding, and Gradle distribution", async () => {
  const [releasePolicy, publisher, verifier, wrapper] = await Promise.all([
    readFile(new URL("scripts/android-release.mjs", repositoryRoot), "utf8"),
    readFile(new URL("scripts/build-android-apk.mjs", repositoryRoot), "utf8"),
    readFile(new URL("scripts/verify-android-apk.mjs", repositoryRoot), "utf8"),
    readFile(
      new URL("android/gradle/wrapper/gradle-wrapper.properties", repositoryRoot),
      "utf8",
    ),
  ]);

  assert.match(
    releasePolicy,
    /expectedSigningCertificateSha256\s*=\s*\n?\s*"15a35456cf92a58c39072bc0306df0843467f529daf361460c15d201a2705f87"/u,
  );
  assert.match(
    releasePolicy,
    /certificateSha256 !== expectedSigningCertificateSha256/u,
  );
  assert.match(releasePolicy, /v2 scheme \(APK Signature Scheme v2\)", true/u);
  assert.match(releasePolicy, /v3 scheme \(APK Signature Scheme v3\)", true/u);
  assert.match(releasePolicy, /Number of signers: 1/u);
  assert.match(releasePolicy, /Verified for SourceStamp: false/u);
  assert.match(publisher, /DIG_SOURCE_COMMIT/u);
  assert.match(publisher, /release-source\.json/u);
  assert.match(releasePolicy, /embedded release source does not match/u);
  assert.match(verifier, /standalone APK checksum does not bind/u);
  assert.match(
    wrapper,
    /^distributionSha256Sum=ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c$/mu,
  );
});
