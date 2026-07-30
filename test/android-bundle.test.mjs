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
  for (const pagesOnlyMetadata of [
    "dist/android/.well-known/security.txt",
    "dist/android/404.html",
    "dist/android/robots.txt",
    "dist/android/sitemap.xml",
  ]) {
    await assert.rejects(readFile(new URL(pagesOnlyMetadata, repositoryRoot)), {
      code: "ENOENT",
    });
  }

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
  const [releasePolicy, publisher, verifier, wrapper, lockVerifier] = await Promise.all([
    readFile(new URL("scripts/android-release.mjs", repositoryRoot), "utf8"),
    readFile(new URL("scripts/build-android-apk.mjs", repositoryRoot), "utf8"),
    readFile(new URL("scripts/verify-android-apk.mjs", repositoryRoot), "utf8"),
    readFile(
      new URL("android/gradle/wrapper/gradle-wrapper.properties", repositoryRoot),
      "utf8",
    ),
    readFile(
      new URL("android/gradle/verify-dependency-locks.gradle", repositoryRoot),
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
  assert.match(publisher, /":verifyDependencyLocks"/u);
  assert.match(releasePolicy, /embedded release source does not match/u);
  assert.match(verifier, /standalone APK checksum does not bind/u);
  assert.match(
    wrapper,
    /^distributionSha256Sum=ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c$/mu,
  );
  assert.match(lockVerifier, /tasks\.register\('verifyDependencyLocks'\)/u);
  assert.match(lockVerifier, /buildscriptLocking\.lockMode\.get\(\) != LockMode\.STRICT/u);
  assert.match(lockVerifier, /buildscriptLocking\.lockFile\.get\(\)\.asFile/u);
  assert.match(lockVerifier, /classpath\.resolutionStrategy\.dependencyLockingEnabled/u);
  assert.match(lockVerifier, /constraintCoordinates != lockedCoordinates/u);
});

test("Android dependency resolution uses reviewed strict Gradle lock state", async () => {
  const [
    settings,
    build,
    rootBuildscriptLock,
    appBuildscriptLock,
    capacitorBuildscriptLock,
    cordovaBuildscriptLock,
    appLock,
    capacitorLock,
    cordovaLock,
  ] = await Promise.all([
    readFile(new URL("android/settings.gradle", repositoryRoot), "utf8"),
    readFile(new URL("android/build.gradle", repositoryRoot), "utf8"),
    readFile(new URL("android/buildscript-gradle.lockfile", repositoryRoot), "utf8"),
    readFile(
      new URL("android/gradle/dependency-locks/app-buildscript.lockfile", repositoryRoot),
      "utf8",
    ),
    readFile(
      new URL(
        "android/gradle/dependency-locks/capacitor-android-buildscript.lockfile",
        repositoryRoot,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "android/gradle/dependency-locks/capacitor-cordova-android-plugins-buildscript.lockfile",
        repositoryRoot,
      ),
      "utf8",
    ),
    readFile(new URL("android/gradle/dependency-locks/app.lockfile", repositoryRoot), "utf8"),
    readFile(
      new URL("android/gradle/dependency-locks/capacitor-android.lockfile", repositoryRoot),
      "utf8",
    ),
    readFile(
      new URL(
        "android/gradle/dependency-locks/capacitor-cordova-android-plugins.lockfile",
        repositoryRoot,
      ),
      "utf8",
    ),
  ]);

  assert.match(settings, /gradle\.beforeProject \{ project ->/u);
  assert.match(settings, /project\.buildscript\.dependencyLocking/u);
  assert.match(settings, /project\.buildscript\.configurations\.classpath/u);
  assert.match(settings, /resolutionStrategy\.activateDependencyLocking\(\)/u);
  assert.match(settings, /lockMode = LockMode\.STRICT/u);
  assert.match(
    settings,
    /gradle\/dependency-locks\/\$\{project\.path\.substring\(1\)\.replace\(':', '-'\)\}-buildscript\.lockfile/u,
  );
  assert.match(build, /lockAllConfigurations\(\)/u);
  assert.match(build, /lockMode = LockMode\.STRICT/u);
  assert.match(build, /gradle\/dependency-locks\/\$\{lockFileName\}/u);
  for (const lock of [
    rootBuildscriptLock,
    appBuildscriptLock,
    capacitorBuildscriptLock,
    cordovaBuildscriptLock,
    appLock,
    capacitorLock,
    cordovaLock,
  ]) {
    assert.match(
      lock,
      /^# This is a Gradle generated file for dependency locking\.\r?\n/u,
    );
    assert.match(lock, /^empty=/mu);
    assert.doesNotMatch(lock, /(?:^|:)latest(?:[.=]|$)|[+*](?:=|,|$)/imu);
  }
  assert.match(
    rootBuildscriptLock,
    /^com\.android\.tools\.build:gradle:8\.13\.0=classpath$/mu,
  );
  assert.match(
    rootBuildscriptLock,
    /^com\.google\.gms:google-services:4\.4\.4=classpath$/mu,
  );
  assert.match(appBuildscriptLock, /^empty=classpath$/mu);
  for (const lock of [capacitorBuildscriptLock, cordovaBuildscriptLock]) {
    assert.match(lock, /^com\.android\.tools\.build:gradle:8\.13\.0=classpath$/mu);
    assert.doesNotMatch(lock, /^com\.google\.gms:google-services:/mu);
  }
  assert.match(appLock, /^androidx\.appcompat:appcompat:1\.7\.1=/mu);
  assert.match(appLock, /^androidx\.coordinatorlayout:coordinatorlayout:1\.3\.0=/mu);
  assert.match(appLock, /^androidx\.core:core-splashscreen:1\.2\.0=/mu);
  assert.match(appLock, /^junit:junit:4\.13\.2=/mu);
  assert.match(capacitorLock, /^androidx\.activity:activity:1\.11\.0=/mu);
  assert.match(capacitorLock, /^androidx\.fragment:fragment:1\.8\.9=/mu);
  assert.match(capacitorLock, /^androidx\.webkit:webkit:1\.14\.0=/mu);
});
