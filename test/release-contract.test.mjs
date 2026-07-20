import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  assembleReleaseBundle,
  validateReleaseBundle,
  validateReleaseMetadata,
  validateVersionTexts,
} from "../scripts/validate-release.mjs";

const VERSION = "2.1.1";
const COMMIT = "a".repeat(40);

test("release metadata and a stable tag stay synchronized", async () => {
  assert.equal(await validateReleaseMetadata({ tag: `v${VERSION}` }), VERSION);
  await assert.rejects(() => validateReleaseMetadata({ tag: VERSION }), /exactly/);
  await assert.rejects(() => validateReleaseMetadata({ tag: `v${VERSION}-rc.1` }), /exactly/);
});

test("version validation rejects drift and npm publication", () => {
  const base = {
    packageJson: JSON.stringify({ name: "dig-gopher-explorer", version: VERSION, private: true, license: "UNLICENSED" }),
    packageLockJson: JSON.stringify({ version: VERSION, packages: { "": { version: VERSION } } }),
    changelog: `## ${VERSION} — 2026-07-20`,
    cli: `process.stdout.write("DIG ${VERSION}\\n")`,
  };
  assert.equal(validateVersionTexts(base), VERSION);
  assert.throws(() => validateVersionTexts({ ...base, packageJson: JSON.stringify({ name: "dig-gopher-explorer", version: VERSION, private: false, license: "UNLICENSED" }) }), /private/);
  assert.throws(() => validateVersionTexts({ ...base, cli: 'process.stdout.write("DIG 9.9.9\\n")' }), /CLI version/);
});

test("release bundle has exact inventory, source binding, and checksums", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "dig-release-contract-"));
  const inputs = join(temporaryRoot, "inputs");
  const output = join(temporaryRoot, "release");
  await mkdir(inputs);
  const archive = join(inputs, "package.tgz");
  const sbom = join(inputs, "sbom.json");
  const dependencies = join(inputs, "dependencies.json");
  await writeFile(archive, gzipSync("verified archive"));
  await writeFile(sbom, JSON.stringify({ bomFormat: "CycloneDX", metadata: { component: { version: VERSION } } }));
  await writeFile(dependencies, JSON.stringify({ version: VERSION }));

  try {
    await assembleReleaseBundle({ outputDirectory: output, sourceCommit: COMMIT, archive, sbom, dependencies });
    await validateReleaseBundle({ directory: output, version: VERSION, sourceCommit: COMMIT });
    await writeFile(join(output, "SOURCE_COMMIT"), `${"b".repeat(40)}\n`);
    await assert.rejects(
      () => validateReleaseBundle({ directory: output, version: VERSION, sourceCommit: COMMIT }),
      /Checksum mismatch|Source commit/,
    );
    assert.match(await readFile(join(output, "SHA256SUMS"), "utf8"), /release-metadata\.json/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
