import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyAndroidApk } from "./android-release.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));

function parseArguments(args) {
  const parsed = new Map();
  const allowed = new Set(["--apk", "--checksum", "--commit"]);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    assert.ok(allowed.has(name), `Unknown argument: ${name}`);
    assert.ok(value && !value.startsWith("--"), `${name} requires a value.`);
    assert.equal(parsed.has(name), false, `Duplicate argument: ${name}`);
    parsed.set(name, value);
  }
  for (const name of allowed) assert.ok(parsed.has(name), `${name} is required.`);
  return parsed;
}

const parsed = parseArguments(process.argv.slice(2));
const packageMetadata = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
const apk = resolve(parsed.get("--apk"));
const checksum = resolve(parsed.get("--checksum"));
const sourceCommit = parsed.get("--commit");
const result = await verifyAndroidApk({
  apk,
  version: packageMetadata.version,
  sourceCommit,
});
const expectedChecksum = `${result.apkSha256}  ${basename(apk)}\n`;
assert.equal(
  await readFile(checksum, "utf8"),
  expectedChecksum,
  "The standalone APK checksum does not bind the verified APK exactly.",
);

console.log(`Verified DIG Android ${result.versionName} (${result.versionCode}) at ${sourceCommit}.`);
console.log(`Package: ${result.applicationId}`);
console.log(`APK SHA-256: ${result.apkSha256}`);
console.log(`Signing certificate SHA-256: ${result.certificateSha256}`);
