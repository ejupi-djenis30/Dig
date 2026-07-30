import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
} from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAndroidWeb } from "./build-android-web.mjs";
import {
  androidApplicationId,
  androidVersionCode,
  verifyAndroidApk,
} from "./android-release.mjs";
import { writeFileAtomic } from "../src/atomic-output.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const androidRoot = resolve(repositoryRoot, "android");
const signingProperties = resolve(repositoryRoot, ".android-signing", "release-signing.properties");
const releaseDirectory = resolve(
  process.env.DIG_ANDROID_RELEASE_DIRECTORY
    ?? resolve(repositoryRoot, "release", "android"),
);
const capacitorCli = resolve(repositoryRoot, "node_modules", "@capacitor", "cli", "bin", "capacitor");

function assertConfined(root, path) {
  const pathFromRoot = relative(root, path);
  if (
    pathFromRoot === ""
    || pathFromRoot === ".."
    || pathFromRoot.startsWith(`..${sep}`)
  ) {
    throw new Error(`Path escapes its expected directory: ${path}`);
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(
        `${basename(command)} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`,
      ));
    });
  });
}

const signingEnvironmentNames = [
  "DIG_ANDROID_KEYSTORE_PATH",
  "DIG_ANDROID_KEYSTORE_PASSWORD",
  "DIG_ANDROID_KEY_ALIAS",
  "DIG_ANDROID_KEY_PASSWORD",
];
const signingEnvironmentConfigured = signingEnvironmentNames.every((name) => process.env[name]);
if (!await exists(signingProperties) && !signingEnvironmentConfigured) {
  throw new Error(
    "Release signing is not configured. Run npm run android:signing:init or set all DIG_ANDROID_KEY* variables.",
  );
}
if (!process.env.JAVA_HOME) {
  throw new Error("JAVA_HOME must point to JDK 21 before building the Android APK.");
}
const javaCommand = resolve(
  process.env.JAVA_HOME,
  "bin",
  process.platform === "win32" ? "java.exe" : "java",
);
const gradleWrapper = resolve(androidRoot, "gradle", "wrapper", "gradle-wrapper.jar");
if (!await exists(javaCommand) || !await exists(gradleWrapper) || !await exists(capacitorCli)) {
  throw new Error("JDK 21, the Gradle wrapper, and installed Capacitor tooling are required.");
}

const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
const versionCode = androidVersionCode(packageMetadata.version);
const sourceCommit = process.env.DIG_SOURCE_COMMIT;
if (!/^[0-9a-f]{40}$/u.test(sourceCommit ?? "")) {
  throw new Error("DIG_SOURCE_COMMIT must identify the exact lowercase 40-character release source.");
}
const artifactName = `DIG-${packageMetadata.version}.apk`;
const sourceApk = resolve(androidRoot, "app", "build", "outputs", "apk", "release", "app-release.apk");
const destinationApk = resolve(releaseDirectory, artifactName);
const checksumPath = `${destinationApk}.sha256`;

assertConfined(androidRoot, sourceApk);
assertConfined(releaseDirectory, destinationApk);
assertConfined(releaseDirectory, checksumPath);

await buildAndroidWeb();
await writeFileAtomic(
  resolve(repositoryRoot, "dist", "android", "release-source.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    project: "DIG",
    version: packageMetadata.version,
    sourceCommit,
  }, null, 2)}\n`,
  { force: true },
);
await run(process.execPath, [capacitorCli, "sync", "android"]);
await run(javaCommand, [
  "-classpath",
  gradleWrapper,
  "org.gradle.wrapper.GradleWrapperMain",
  "--no-daemon",
  "clean",
  ":verifyDependencyLocks",
  ":app:testDebugUnitTest",
  ":app:lintRelease",
  ":app:assembleDebugAndroidTest",
  ":app:assembleRelease",
], { cwd: androidRoot });

if (!await exists(sourceApk)) {
  throw new Error(`The signed release APK was not produced at ${sourceApk}`);
}

const verification = await verifyAndroidApk({
  apk: sourceApk,
  version: packageMetadata.version,
  sourceCommit,
});
const apkBytes = await readFile(sourceApk);
const digest = createHash("sha256").update(apkBytes).digest("hex");
if (digest !== verification.apkSha256) {
  throw new Error("The verified APK changed before release staging.");
}
await mkdir(releaseDirectory, { recursive: true });
await writeFileAtomic(destinationApk, apkBytes, { force: true });
await writeFileAtomic(
  checksumPath,
  `${digest}  ${artifactName}\n`,
  { force: true },
);

console.log(`Android APK: ${destinationApk}`);
console.log(`SHA-256: ${digest}`);
console.log(`Package: ${androidApplicationId}`);
console.log(`Version code: ${versionCode}`);
console.log(`Source commit: ${sourceCommit}`);
console.log(`Signing certificate SHA-256: ${verification.certificateSha256}`);
