import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assembleReleaseBundle,
  validateReleaseBundle,
  validateReleaseMetadata,
  validateVersionTexts,
} from "../scripts/validate-release.mjs";
import { normalizeCycloneDx } from "../scripts/normalize-sbom.mjs";
import {
  localAssetManifest,
  publishReleaseCandidate,
  verifyPublishedAssets,
} from "../scripts/publish-release.mjs";

const VERSION = "2.1.1";
const COMMIT = "a".repeat(40);
const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));

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
  assert.throws(
    () => validateVersionTexts({ ...base, changelog: `<!-- ## ${VERSION} — 2026-07-20 -->` }),
    /one real/,
  );
  assert.throws(
    () => validateVersionTexts({ ...base, changelog: `\`\`\`md\n## ${VERSION} — 2026-07-20\n\`\`\`` }),
    /one real/,
  );
  assert.throws(
    () => validateVersionTexts({ ...base, changelog: `## ${VERSION} — 2026-02-30` }),
    /invalid date/,
  );
});

test("SBOM normalization removes volatile metadata and canonicalizes object keys", () => {
  const first = normalizeCycloneDx({
    serialNumber: "urn:uuid:first",
    metadata: { timestamp: "2026-07-20T01:00:00Z", component: { version: VERSION, name: "dig" } },
    specVersion: "1.6",
    bomFormat: "CycloneDX",
  });
  const second = normalizeCycloneDx({
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    metadata: { component: { name: "dig", version: VERSION }, timestamp: "2026-07-20T02:00:00Z" },
    serialNumber: "urn:uuid:second",
  });
  assert.deepEqual(first, second);
  assert.equal(first.serialNumber, undefined);
  assert.equal(first.metadata.timestamp, undefined);
});

test("release bundle has exact inventory, source binding, and checksums", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "dig-release-contract-"));
  const inputs = join(temporaryRoot, "inputs");
  const output = join(temporaryRoot, "release");
  await mkdir(inputs);
  assert.ok(process.env.npm_execpath, "Tests must run through npm so the pack command is portable.");
  const packed = spawnSync(
    process.execPath,
    [process.env.npm_execpath, "pack", "--ignore-scripts", "--pack-destination", inputs],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const archive = join(inputs, packed.stdout.trim().split(/\r?\n/).at(-1));
  const sbom = join(inputs, "sbom.json");
  const dependencies = join(inputs, "dependencies.json");
  await writeFile(
    sbom,
    JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      metadata: {
        component: {
          "bom-ref": `dig-gopher-explorer@${VERSION}`,
          purl: `pkg:npm/dig-gopher-explorer@${VERSION}`,
          version: VERSION,
        },
      },
      components: [],
      dependencies: [{ ref: `dig-gopher-explorer@${VERSION}`, dependsOn: [] }],
    }),
  );
  await writeFile(dependencies, JSON.stringify({ name: "dig-gopher-explorer", version: VERSION }));

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

test("release publishing verifies every remote digest before promotion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dig-publish-contract-"));
  await writeFile(join(directory, "asset-a.txt"), "alpha");
  await writeFile(join(directory, "asset-b.txt"), "beta");
  const expected = await localAssetManifest(directory);
  const calls = [];
  let viewCount = 0;
  const run = (args) => {
    calls.push(args);
    if (args[0] === "release" && args[1] === "create") return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "release" && args[1] === "edit") return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "release" && args[1] === "view") {
      viewCount += 1;
      if (viewCount === 1) return { status: 1, stdout: "", stderr: "release not found" };
      const published = expected.map(({ name, digest }) => ({ name, digest }));
      return {
        status: 0,
        stdout: JSON.stringify({
          tagName: "v2.1.1",
          isDraft: viewCount === 2,
          isLatest: viewCount > 2,
          assets: published,
        }),
        stderr: "",
      };
    }
    throw new Error(`Unexpected gh call: ${args.join(" ")}`);
  };

  try {
    await publishReleaseCandidate({
      directory,
      tag: "v2.1.1",
      repository: "owner/repository",
      run,
      pause: async () => {},
    });
    assert.ok(calls.some((args) => args[1] === "create"));
    assert.ok(calls.some((args) => args[1] === "edit"));
    assert.ok(!calls.some((args) => args[1] === "delete"));
    assert.throws(
      () => verifyPublishedAssets(expected, [{ name: expected[0].name, digest: "sha256:wrong" }]),
      /do not match/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release publishing cleans up a draft that fails digest verification", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dig-publish-cleanup-"));
  await writeFile(join(directory, "asset.txt"), "verified");
  const calls = [];
  let firstView = true;
  const run = (args) => {
    calls.push(args);
    if (args[1] === "view" && firstView) {
      firstView = false;
      return { status: 1, stdout: "", stderr: "HTTP 404: Not Found" };
    }
    if (args[1] === "create" || args[1] === "delete") return { status: 0, stdout: "", stderr: "" };
    if (args[1] === "view") {
      return {
        status: 0,
        stdout: JSON.stringify({
          tagName: "v2.1.1",
          isDraft: true,
          assets: [{ name: "asset.txt", digest: "sha256:wrong" }],
        }),
        stderr: "",
      };
    }
    throw new Error(`Unexpected gh call: ${args.join(" ")}`);
  };
  try {
    await assert.rejects(
      () =>
        publishReleaseCandidate({
          directory,
          tag: "v2.1.1",
          repository: "owner/repository",
          run,
          pause: async () => {},
        }),
      /do not match/,
    );
    assert.ok(calls.some((args) => args[1] === "delete"));
    assert.ok(!calls.some((args) => args[1] === "edit"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release publishing never deletes a release after promotion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dig-publish-promoted-"));
  await writeFile(join(directory, "asset.txt"), "verified");
  const expected = await localAssetManifest(directory);
  const calls = [];
  let viewCount = 0;
  const run = (args) => {
    calls.push(args);
    if (args[1] === "view") {
      viewCount += 1;
      if (viewCount === 1) return { status: 1, stdout: "", stderr: "release not found" };
      return {
        status: 0,
        stdout: JSON.stringify({
          tagName: "v2.1.1",
          isDraft: viewCount === 2,
          isLatest: false,
          assets: expected.map(({ name, digest }) => ({ name, digest })),
        }),
        stderr: "",
      };
    }
    if (args[1] === "create" || args[1] === "edit") return { status: 0, stdout: "", stderr: "" };
    throw new Error(`Unexpected gh call: ${args.join(" ")}`);
  };
  try {
    await assert.rejects(
      () =>
        publishReleaseCandidate({
          directory,
          tag: "v2.1.1",
          repository: "owner/repository",
          run,
          pause: async () => {},
        }),
      /not promoted to latest/,
    );
    assert.ok(calls.some((args) => args[1] === "edit"));
    assert.ok(!calls.some((args) => args[1] === "delete"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
