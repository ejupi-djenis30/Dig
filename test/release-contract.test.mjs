import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  assembleReleaseBundle,
  tarFiles,
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

function tarHeader(name, type, size = 0) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(size.toString(8).padStart(11, "0"), 124, 11, "ascii");
  header[135] = 0;
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

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
  assert.equal(
    validateVersionTexts({
      ...base,
      changelog: `<!--\n## ${VERSION} — 2026-07-19\n-->\n## ${VERSION} — 2026-07-20 <!-- release note -->`,
    }),
    VERSION,
  );
  assert.throws(
    () => validateVersionTexts({ ...base, changelog: `<!-- unclosed\n## ${VERSION} — 2026-07-20` }),
    /one real/,
  );
  assert.throws(
    () => validateVersionTexts({ ...base, changelog: `\`\`\`md\n## ${VERSION} — 2026-07-20\n\`\`\`` }),
    /one real/,
  );
  assert.throws(
    () => validateVersionTexts({
      ...base,
      changelog: `\`\`\`\`md\nnot a release\n\`\`\`\n## ${VERSION} — 2026-07-20\n\`\`\`\``,
    }),
    /one real/,
  );
  assert.throws(
    () => validateVersionTexts({
      ...base,
      changelog: `\`\`\`\`md\n\`\`\`<!-- still fenced -->\n## ${VERSION} — 2026-07-20\n\`\`\`\``,
    }),
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

test("tar validation rejects unexpected entry types and non-zero padding", () => {
  const directoryArchive = gzipSync(Buffer.concat([
    tarHeader("package/unexpected-directory/", "5"),
    Buffer.alloc(1024),
  ]));
  assert.throws(() => tarFiles(directoryArchive), /Unsupported tar entry type/);

  const contentBlock = Buffer.alloc(512);
  contentBlock[0] = 0x61;
  contentBlock[1] = 0x62;
  const paddedArchive = gzipSync(Buffer.concat([
    tarHeader("package/file.txt", "0", 1),
    contentBlock,
    Buffer.alloc(1024),
  ]));
  assert.throws(() => tarFiles(paddedArchive), /non-zero padding/);
});

function apiResult(args, {
  expected,
  defaultCommit = COMMIT,
  tagCommit = COMMIT,
  publishedImmutable = true,
  latestId = 42,
} = {}) {
  const endpoint = args.at(-1);
  let body;
  if (endpoint === "repos/owner/repository/commits/main") body = { sha: defaultCommit };
  else if (endpoint === "repos/owner/repository/git/ref/tags/v2.1.1") {
    body = { object: { type: "commit", sha: tagCommit } };
  } else if (endpoint === "repos/owner/repository/releases/tags/v2.1.1") {
    body = {
      id: 42,
      tag_name: "v2.1.1",
      draft: false,
      immutable: publishedImmutable,
      assets: expected.map(({ name, digest }) => ({ name, digest })),
    };
  } else if (endpoint === "repos/owner/repository/releases/latest") {
    body = { id: latestId, tag_name: latestId === 42 ? "v2.1.1" : "v2.1.0" };
  } else throw new Error(`Unexpected GitHub API call: ${endpoint}`);
  return { status: 0, stdout: JSON.stringify(body), stderr: "" };
}

test("release publishing verifies source, digests, latest status, and immutability", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dig-publish-contract-"));
  await writeFile(join(directory, "asset-a.txt"), "alpha");
  await writeFile(join(directory, "asset-b.txt"), "beta");
  const expected = await localAssetManifest(directory);
  const calls = [];
  let viewCount = 0;
  const run = (args) => {
    calls.push(args);
    if (args[0] === "api") return apiResult(args, { expected });
    if (args[1] === "create" || args[1] === "edit") return { status: 0, stdout: "", stderr: "" };
    if (args[1] === "view") {
      viewCount += 1;
      if (viewCount === 1) return { status: 1, stdout: "", stderr: "release not found" };
      return {
        status: 0,
        stdout: JSON.stringify({
          databaseId: 42,
          tagName: "v2.1.1",
          isDraft: true,
          assets: expected.map(({ name, digest }) => ({ name, digest })),
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
      defaultBranch: "main",
      sourceCommit: COMMIT,
      run,
      pause: async () => {},
    });
    assert.ok(calls.some((args) => args[1] === "create"));
    assert.ok(calls.some((args) => args[1] === "edit"));
    assert.equal(calls.filter((args) => args.at(-1) === "repos/owner/repository/git/ref/tags/v2.1.1").length, 2);
    assert.ok(!calls.some((args) => args[1] === "delete"));
    assert.throws(
      () => verifyPublishedAssets(expected, [{ name: expected[0].name, digest: "sha256:wrong" }]),
      /do not match/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release publishing cleans up a candidate draft after partial create failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dig-publish-partial-"));
  await writeFile(join(directory, "asset-a.txt"), "alpha");
  await writeFile(join(directory, "asset-b.txt"), "beta");
  const expected = await localAssetManifest(directory);
  const calls = [];
  let viewCount = 0;
  const run = (args) => {
    calls.push(args);
    if (args[0] === "api") return apiResult(args, { expected });
    if (args[1] === "create") return { status: 1, stdout: "", stderr: "upload failed" };
    if (args[1] === "delete") return { status: 0, stdout: "", stderr: "" };
    if (args[1] === "view") {
      viewCount += 1;
      if (viewCount === 1) return { status: 1, stdout: "", stderr: "HTTP 404: Not Found" };
      return {
        status: 0,
        stdout: JSON.stringify({
          tagName: "v2.1.1",
          isDraft: true,
          assets: expected.slice(0, 1).map(({ name }) => ({ name, digest: null })),
        }),
        stderr: "",
      };
    }
    throw new Error(`Unexpected gh call: ${args.join(" ")}`);
  };
  try {
    await assert.rejects(
      () => publishReleaseCandidate({
        directory,
        tag: "v2.1.1",
        repository: "owner/repository",
        defaultBranch: "main",
        sourceCommit: COMMIT,
        run,
        pause: async () => {},
      }),
      /upload failed/,
    );
    assert.ok(calls.some((args) => args[1] === "delete"));
    assert.ok(!calls.some((args) => args[1] === "edit"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release publishing refuses to delete a draft with foreign assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dig-publish-foreign-"));
  await writeFile(join(directory, "asset.txt"), "verified");
  const expected = await localAssetManifest(directory);
  let viewCount = 0;
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[0] === "api") return apiResult(args, { expected });
    if (args[1] === "create") return { status: 1, stdout: "", stderr: "upload failed" };
    if (args[1] === "view") {
      viewCount += 1;
      if (viewCount === 1) return { status: 1, stdout: "", stderr: "release not found" };
      return {
        status: 0,
        stdout: JSON.stringify({
          tagName: "v2.1.1",
          isDraft: true,
          assets: [{ name: "foreign.txt", digest: "sha256:foreign" }],
        }),
        stderr: "",
      };
    }
    throw new Error(`Unexpected gh call: ${args.join(" ")}`);
  };
  try {
    await assert.rejects(
      () => publishReleaseCandidate({
        directory,
        tag: "v2.1.1",
        repository: "owner/repository",
        defaultBranch: "main",
        sourceCommit: COMMIT,
        run,
        pause: async () => {},
      }),
      /Cleanup also failed.*foreign\.txt/,
    );
    assert.ok(!calls.some((args) => args[1] === "delete"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release publishing fails closed when source bindings drift", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dig-publish-preflight-"));
  await writeFile(join(directory, "asset.txt"), "verified");
  const expected = await localAssetManifest(directory);
  try {
    for (const [options, pattern] of [
      [{ defaultCommit: "b".repeat(40) }, /no longer the current main commit/],
      [{ tagCommit: "b".repeat(40) }, /does not resolve to the verified source commit/],
    ]) {
      const calls = [];
      await assert.rejects(
        () => publishReleaseCandidate({
          directory,
          tag: "v2.1.1",
          repository: "owner/repository",
          defaultBranch: "main",
          sourceCommit: COMMIT,
          run: (args) => {
            calls.push(args);
            if (args[0] === "api") return apiResult(args, { expected, ...options });
            throw new Error(`Unexpected mutation: ${args.join(" ")}`);
          },
          pause: async () => {},
        }),
        pattern,
      );
      assert.ok(calls.every((args) => args[0] === "api"));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release publishing verifies immutable latest state after promotion without deleting it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dig-publish-promoted-"));
  await writeFile(join(directory, "asset.txt"), "verified");
  const expected = await localAssetManifest(directory);
  try {
    for (const [apiOptions, pattern] of [
      [{ latestId: 7 }, /not promoted to latest/],
      [{ publishedImmutable: false }, /not immutable/],
    ]) {
      const calls = [];
      let viewCount = 0;
      const run = (args) => {
        calls.push(args);
        if (args[0] === "api") return apiResult(args, { expected, ...apiOptions });
        if (args[1] === "create" || args[1] === "edit") return { status: 0, stdout: "", stderr: "" };
        if (args[1] === "view") {
          viewCount += 1;
          if (viewCount === 1) return { status: 1, stdout: "", stderr: "release not found" };
          return {
            status: 0,
            stdout: JSON.stringify({
              databaseId: 42,
              tagName: "v2.1.1",
              isDraft: true,
              assets: expected.map(({ name, digest }) => ({ name, digest })),
            }),
            stderr: "",
          };
        }
        throw new Error(`Unexpected gh call: ${args.join(" ")}`);
      };
      await assert.rejects(
        () => publishReleaseCandidate({
          directory,
          tag: "v2.1.1",
          repository: "owner/repository",
          defaultBranch: "main",
          sourceCommit: COMMIT,
          run,
          pause: async () => {},
        }),
        pattern,
      );
      assert.ok(calls.some((args) => args[1] === "edit"));
      assert.ok(!calls.some((args) => args[1] === "delete"));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
