import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { buildAndroidWeb } from "./build-android-web.mjs";
import { writeFileAtomic } from "../src/atomic-output.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const androidRoot = resolve(repositoryRoot, "android");
const signingProperties = resolve(repositoryRoot, ".android-signing", "release-signing.properties");
const releaseDirectory = resolve(repositoryRoot, "release", "android");
const capacitorCli = resolve(repositoryRoot, "node_modules", "@capacitor", "cli", "bin", "capacitor");
const expectedSigningCertificateSha256 =
  "15a35456cf92a58c39072bc0306df0843467f529daf361460c15d201a2705f87";

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

function containsRepositorySourceLink(html) {
  const hrefPattern = /\bhref\s*=\s*(["'])(?<href>.*?)\1/giu;
  for (const match of html.matchAll(hrefPattern)) {
    try {
      const target = new URL(match.groups.href, "https://dig.invalid/");
      if (
        target.protocol === "https:"
        && target.hostname === "github.com"
        && target.port === ""
        && target.username === ""
        && target.password === ""
        && target.pathname.replace(/\/+$/u, "") === "/ejupi-djenis30/Dig"
        && target.search === ""
        && target.hash === ""
      ) {
        return true;
      }
    } catch {
      // A malformed href is not the exact repository URL checked by this policy.
    }
  }
  return false;
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

function runCaptured(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let outputError = null;
    const append = (current, chunk) => {
      if (outputError) return current;
      const next = current + chunk;
      if (next.length > 1_048_576) {
        outputError = new Error(`${basename(command)} produced unexpectedly large output.`);
        child.kill();
        return current;
      }
      return next;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (outputError) {
        rejectRun(outputError);
        return;
      }
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      rejectRun(new Error(
        `${basename(command)} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`
        + (stderr.trim() ? `: ${stderr.trim()}` : "."),
      ));
    });
  });
}

function escapedJavaProperty(value) {
  return value.replace(/\\([\\:= ])/gu, "$1");
}

async function findAndroidSdk() {
  const environmentPath = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (environmentPath) return resolve(environmentPath);
  const localProperties = await readFile(
    resolve(androidRoot, "local.properties"),
    "utf8",
  );
  const sdkProperty = /^sdk\.dir=(.+)$/mu.exec(localProperties)?.[1]?.trim();
  if (!sdkProperty) {
    throw new Error("Android SDK location is not configured.");
  }
  return resolve(escapedJavaProperty(sdkProperty));
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function findBuildTools(androidSdk) {
  const versions = (await readdir(resolve(androidSdk, "build-tools"), {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+)+$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareVersions);
  const version = versions.at(-1);
  if (!version) throw new Error("No stable Android build-tools installation was found.");
  return resolve(androidSdk, "build-tools", version);
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

async function verifyApk({
  apk,
  applicationId,
  versionName,
  versionCode,
  javaCommand,
}) {
  const androidSdk = await findAndroidSdk();
  const buildTools = await findBuildTools(androidSdk);
  const aapt2 = resolve(
    buildTools,
    process.platform === "win32" ? "aapt2.exe" : "aapt2",
  );
  const apksigner = resolve(buildTools, "lib", "apksigner.jar");
  const jarCommand = resolve(
    process.env.JAVA_HOME,
    "bin",
    process.platform === "win32" ? "jar.exe" : "jar",
  );
  for (const tool of [aapt2, apksigner, jarCommand]) {
    if (!await exists(tool)) throw new Error(`Required APK inspection tool is missing: ${tool}`);
  }

  const [
    { stdout: badging },
    { stdout: permissions },
    { stdout: manifestTree },
    { stdout: signature },
  ] =
    await Promise.all([
      runCaptured(aapt2, ["dump", "badging", apk]),
      runCaptured(aapt2, ["dump", "permissions", apk]),
      runCaptured(aapt2, ["dump", "xmltree", apk, "--file", "AndroidManifest.xml"]),
      runCaptured(javaCommand, [
        "-jar",
        apksigner,
        "verify",
        "--verbose",
        "--print-certs",
        apk,
      ]),
    ]);

  const packageLine = /^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/mu
    .exec(badging);
  if (
    packageLine?.[1] !== applicationId
    || packageLine?.[2] !== String(versionCode)
    || packageLine?.[3] !== versionName
    || !badging.includes("minSdkVersion:'24'")
    || !badging.includes("targetSdkVersion:'36'")
    || badging.includes("application-debuggable")
    || manifestTree.includes("android:debuggable")
  ) {
    throw new Error("The packaged Android identity, SDK levels, or release flags are invalid.");
  }

  const packagedPermissions = [
    ...permissions.matchAll(/uses-permission(?:-sdk-\d+)?: name='([^']+)'/gu),
  ].map((match) => match[1]).sort();
  const receiverPermission = `${applicationId}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`;
  const expectedPermissions = [
    "android.permission.INTERNET",
    receiverPermission,
  ].sort();
  if (JSON.stringify(packagedPermissions) !== JSON.stringify(expectedPermissions)) {
    throw new Error(`Unexpected Android permissions: ${packagedPermissions.join(", ")}`);
  }
  const customPermissionStart = manifestTree.indexOf(`E: permission`);
  const customPermissionName = manifestTree.indexOf(receiverPermission);
  const customPermissionBlock = manifestTree.slice(
    customPermissionStart,
    customPermissionName + 500,
  );
  if (
    customPermissionStart < 0
    || customPermissionName < customPermissionStart
    || !customPermissionBlock.includes("protectionLevel")
    || !customPermissionBlock.includes("=0x00000002")
  ) {
    throw new Error("AndroidX receiver permission is not protected at signature level.");
  }

  for (const scheme of [
    "v2 scheme (APK Signature Scheme v2)",
    "v3 scheme (APK Signature Scheme v3)",
  ]) {
    if (!signature.includes(`Verified using ${scheme}: true`)) {
      throw new Error(`The APK is missing required ${scheme}.`);
    }
  }
  const certificateSha256 =
    /Signer #1 certificate SHA-256 digest: ([a-f0-9]{64})/u.exec(signature)?.[1];
  if (!certificateSha256) {
    throw new Error("The APK signing certificate fingerprint could not be verified.");
  }
  if (certificateSha256 !== expectedSigningCertificateSha256) {
    throw new Error(
      "The APK was signed by an unexpected certificate. "
      + `Expected ${expectedSigningCertificateSha256}, received ${certificateSha256}.`,
    );
  }

  const inspectionDirectory = await mkdtemp(join(tmpdir(), "dig-apk-inspection-"));
  try {
    await run(jarCommand, ["-xf", apk], { cwd: inspectionDirectory });
    const publicAssets = resolve(inspectionDirectory, "assets", "public");
    assertConfined(inspectionDirectory, publicAssets);
    const index = await readFile(resolve(publicAssets, "index.html"), "utf8");
    if (
      index.includes('class="github-link"')
      || />Source\s*</iu.test(index)
      || containsRepositorySourceLink(index)
    ) {
      throw new Error("The packaged Android UI still contains a Source link.");
    }
    const repositoryUrl = Buffer.from("https://github.com/ejupi-djenis30/Dig");
    for (const path of await filesUnder(publicAssets)) {
      if ((await readFile(path)).includes(repositoryUrl)) {
        throw new Error(`Packaged Android asset still contains the Source URL: ${path}`);
      }
    }
  } finally {
    const pathFromTemporaryRoot = relative(tmpdir(), inspectionDirectory);
    if (
      pathFromTemporaryRoot === ""
      || pathFromTemporaryRoot === ".."
      || pathFromTemporaryRoot.startsWith(`..${sep}`)
      || !basename(inspectionDirectory).startsWith("dig-apk-inspection-")
    ) {
      throw new Error("Refusing to remove an unsafe APK inspection directory.");
    }
    await rm(inspectionDirectory, { recursive: true, force: true });
  }

  return certificateSha256;
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
const versionParts = packageMetadata.version.split(".").map(Number);
if (
  versionParts.length !== 3
  || versionParts.some((part) => !Number.isInteger(part) || part < 0 || part > 99)
) {
  throw new Error("Android versionCode requires a three-part version below 100.100.100.");
}
const versionCode = (
  (versionParts[0] * 10_000)
  + (versionParts[1] * 100)
  + versionParts[2]
);
const artifactName = `DIG-${packageMetadata.version}.apk`;
const sourceApk = resolve(androidRoot, "app", "build", "outputs", "apk", "release", "app-release.apk");
const destinationApk = resolve(releaseDirectory, artifactName);
const checksumPath = `${destinationApk}.sha256`;

assertConfined(androidRoot, sourceApk);
assertConfined(releaseDirectory, destinationApk);
assertConfined(releaseDirectory, checksumPath);

await buildAndroidWeb();
await run(process.execPath, [capacitorCli, "sync", "android"]);
await run(javaCommand, [
  "-classpath",
  gradleWrapper,
  "org.gradle.wrapper.GradleWrapperMain",
  "clean",
  ":app:testDebugUnitTest",
  ":app:lintRelease",
  ":app:assembleDebugAndroidTest",
  ":app:assembleRelease",
], { cwd: androidRoot });

if (!await exists(sourceApk)) {
  throw new Error(`The signed release APK was not produced at ${sourceApk}`);
}

const certificateSha256 = await verifyApk({
  apk: sourceApk,
  applicationId: "com.ejupilabs.dig",
  versionName: packageMetadata.version,
  versionCode,
  javaCommand,
});
const apkBytes = await readFile(sourceApk);
const digest = createHash("sha256").update(apkBytes).digest("hex");
await mkdir(releaseDirectory, { recursive: true });
await writeFileAtomic(destinationApk, apkBytes, { force: true });
await writeFileAtomic(
  checksumPath,
  `${digest}  ${artifactName}\n`,
  { force: true },
);

console.log(`Android APK: ${destinationApk}`);
console.log(`SHA-256: ${digest}`);
console.log(`Signing certificate SHA-256: ${certificateSha256}`);
