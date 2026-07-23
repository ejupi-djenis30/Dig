import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  assembleReleaseBundle,
  parseChangelogSections,
  tarFiles,
  validateReleaseBundle,
  validateMitLicenseText,
  validateReleaseMetadata,
  validateVersionTexts,
} from "../scripts/validate-release.mjs";
import { normalizeCycloneDx } from "../scripts/normalize-sbom.mjs";
import {
  localAssetManifest,
  publishReleaseCandidate,
  verifyLocalChecksumManifest,
  verifyPublishedAssets,
} from "../scripts/publish-release.mjs";

const VERSION = "2.1.4";
const COMMIT = "a".repeat(40);
const RELEASE_TOOLING = {
  "@playwright/test": "1.61.1",
  "remark-parse": "11.0.0",
  unified: "11.0.5",
  yaml: "2.9.0",
};
const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const temporaryDirectories = new Set();

test.afterEach(async () => {
  await Promise.all([...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })));
  temporaryDirectories.clear();
});

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

test("the checked-in license is the approved canonical MIT grant", async () => {
  const license = await readFile(resolve(repositoryRoot, "LICENSE"), "utf8");
  validateMitLicenseText(license);
  assert.throws(
    () => validateMitLicenseText(license.replace("DIG contributors", "a named collaborator")),
    /canonical MIT terms/,
  );
});

test("version validation uses top-level CommonMark H2 sections and real list notes", () => {
  const base = {
    packageJson: JSON.stringify({
      name: "dig-gopher-explorer",
      version: VERSION,
      private: true,
      license: "MIT",
      devDependencies: RELEASE_TOOLING,
    }),
    packageLockJson: JSON.stringify({
      version: VERSION,
      packages: { "": { version: VERSION, license: "MIT", devDependencies: RELEASE_TOOLING } },
    }),
    changelog: `## ${VERSION} — 2026-07-20\n\n- Released`,
    cli: `process.stdout.write("DIG ${VERSION}\\n")`,
  };
  assert.equal(validateVersionTexts(base), VERSION);
  assert.throws(() => validateVersionTexts({
    ...base,
    packageJson: JSON.stringify({
      name: "dig-gopher-explorer",
      version: VERSION,
      private: false,
      license: "MIT",
      devDependencies: RELEASE_TOOLING,
    }),
  }), /private/);
  assert.throws(() => validateVersionTexts({
    ...base,
    packageJson: JSON.stringify({
      name: "dig-gopher-explorer",
      version: VERSION,
      private: true,
      license: "MIT",
      devDependencies: { ...RELEASE_TOOLING, yaml: "^2.9.0" },
    }),
  }), /exactly pinned/);
  assert.throws(() => validateVersionTexts({
    ...base,
    packageJson: JSON.stringify({
      name: "dig-gopher-explorer",
      version: VERSION,
      private: true,
      license: "UNLICENSED",
      devDependencies: RELEASE_TOOLING,
    }),
  }), /MIT SPDX/);
  assert.throws(() => validateVersionTexts({
    ...base,
    packageLockJson: JSON.stringify({
      version: VERSION,
      packages: { "": { version: VERSION, license: "UNLICENSED", devDependencies: RELEASE_TOOLING } },
    }),
  }), /MIT SPDX/);
  assert.throws(() => validateVersionTexts({ ...base, cli: 'process.stdout.write("DIG 9.9.9\\n")' }), /CLI version/);
  assert.throws(
    () => validateVersionTexts({ ...base, changelog: `<!-- ## ${VERSION} — 2026-07-20 -->` }),
    /one real/,
  );
  assert.throws(
    () => validateVersionTexts({ ...base, changelog: `<!-- hidden -->## ${VERSION} — 2026-07-20` }),
    /one real/,
  );
  assert.throws(
    () => validateVersionTexts({
      ...base,
      changelog: `## ![${VERSION} — 2026-07-20](one-pixel.png "release title")\n\n- Released`,
    }),
    /one real/,
  );
  assert.throws(
    () => validateVersionTexts({
      ...base,
      changelog: `## <!-- ${VERSION} — 2026-07-20 -->\n\n- Released`,
    }),
    /one real/,
  );
  assert.equal(
    validateVersionTexts({
      ...base,
      changelog: `<!--\n## ${VERSION} — 2026-07-19\n-->\n## ${VERSION} — 2026-07-20 <!-- release note -->\n\n- Released`,
    }),
    VERSION,
  );
  assert.equal(
    validateVersionTexts({
      ...base,
      changelog: `## [**${VERSION}**](https://example.test/release) — \`2026-07-20\`\n\n- [**Visible release**](https://example.test/notes) with \`code\``,
    }),
    VERSION,
  );
  assert.throws(
    () => validateVersionTexts({ ...base, changelog: `<!-- unclosed\n## ${VERSION} — 2026-07-20` }),
    /one real/,
  );
  const hiddenHeadings = [
    `\`\`\`md\n## ${VERSION} — 2026-07-20\n- Hidden\n\`\`\``,
    `    ## ${VERSION} — 2026-07-20\n    - Hidden`,
    `> ## ${VERSION} — 2026-07-20\n> - Hidden`,
    `- item\n\n  ## ${VERSION} — 2026-07-20\n\n  - Hidden`,
    `<!--\n## ${VERSION} — 2026-07-20\n- Hidden\n-->`,
    `<?release\n## ${VERSION} — 2026-07-20\n- Hidden\n?>`,
    `<!RELEASE\n## ${VERSION} — 2026-07-20\n- Hidden\n>`,
    `<![CDATA[\n## ${VERSION} — 2026-07-20\n- Hidden\n]]>`,
  ];
  for (const changelog of hiddenHeadings) {
    assert.throws(
      () => validateVersionTexts({ ...base, changelog }),
      /one real/,
    );
  }
  for (const changelog of [
    `<pre>\n## ${VERSION} — 2026-07-20\n- Hidden\n</pre>`,
    `<script>\n## ${VERSION} — 2026-07-20\n- Hidden\n</script>`,
    `<style>\n## ${VERSION} — 2026-07-20\n- Hidden\n</style>`,
    `<textarea>\n## ${VERSION} — 2026-07-20\n- Hidden\n</textarea>`,
    `<div>\n## ${VERSION} — 2026-07-20\n- Hidden\n</div>`,
    `<x-release>\n## ${VERSION} — 2026-07-20\n- Hidden\n\n`,
    `<details>\n<summary>Older release</summary>\n\n## ${VERSION} — 2026-07-20\n\n- Hidden\n</details>`,
    `<div hidden>\n\n## ${VERSION} — 2026-07-20\n\n- Hidden\n</div>`,
  ]) assert.throws(() => validateVersionTexts({ ...base, changelog }), /structural HTML wrappers/);
  for (const changelog of [
    `## ${VERSION} — 2026-07-20\n\n> - Quoted only`,
    `## ${VERSION} — 2026-07-20\n\n\`\`\`md\n- Fenced only\n\`\`\``,
  ]) assert.throws(() => validateVersionTexts({ ...base, changelog }), /top-level CommonMark list/);
  assert.throws(
    () => validateVersionTexts({ ...base, changelog: `## ${VERSION} — 2026-07-20\n\n<div>\n- HTML only\n</div>` }),
    /structural HTML wrappers/,
  );

  for (const changelog of [
    `   ## ${VERSION} — 2026-07-20\n\n- Indented ATX`,
    `${VERSION} — 2026-07-20\n------------------\n\n- Setext`,
  ]) assert.equal(validateVersionTexts({ ...base, changelog }), VERSION);

  assert.throws(
    () => validateVersionTexts({ ...base, changelog: `## ${VERSION} — 2026-02-30\n\n- Invalid date` }),
    /invalid date/,
  );
  for (const note of [
    "<!-- hidden -->",
    "![Release details](one-pixel.png \"image title\")",
    "[![Release details](one-pixel.png)](https://example.test/release \"link title\")",
    "![Release details][release-image]\n\n[release-image]: one-pixel.png \"image title\"",
    "** **",
    "[ ](https://example.test/release \"link title\")",
    "` `",
    "\u200B",
    "&#x200B;",
    "`\u200B`",
    "\u2060",
    "&#x2060;",
    "`\u2060`",
    "\u034F",
    "&#x34F;",
    "`\u034F`",
    "\u180B",
    "&#x180B;",
    "`\u180B`",
    "\uFE0F",
    "&#xFE0F;",
    "`\uFE0F`",
    "\u115F",
    "&#x115F;",
    "`\u115F`",
    "\u1160",
    "&#x1160;",
    "`\u1160`",
    "\u3164",
    "&#x3164;",
    "`\u3164`",
    "\uFFA0",
    "&#xFFA0;",
    "`\uFFA0`",
    "...",
    "<https://example.test/releases/2.1.1>",
    "https://example.test/releases/2.1.1",
    "ｈｔｔｐｓ：／／example.test/releases/2.1.1",
    "gopher://example.test/1/releases",
    "www.example.test/releases/2.1.1",
    "h\u034Fttps://example.test/release",
    "h&#x34F;ttps://example.test/release",
    "h\uFE0Fttps://example.test/release",
    "`h\u180Bttps://example.test/release`",
    "h`\u180B`ttps://example.test/release",
    "<mailto:release@example.test>",
    "mailto:release@example.test",
    "data:text/plain,release",
    "urn:example:release",
    "//example.test/release",
    "example.test/release",
    "例え。テスト/リリース",
    "例え｡テスト/リリース",
    "उदाहरण.भारत/रिलीज",
    "xn--r8jz45g.xn--zckzah/release",
    "例え.テスト/リリース",
    "127.0.0.1:3000/release",
    "127.1",
    "0x7f000001",
    "2130706433",
    "[::1]:3000/release",
    "2001:db8::ff00:42:8329",
    "localhost:3000/release",
    "localhost.localdomain",
    "localhost.example.test",
    "127.0.0.1.example.test",
    "release@example.test",
    "release@localhost",
    "release@[IPv6:::1]",
    "release@例え.テスト",
    "git@example.test:owner/repo",
    "/releases",
    "./releases",
    "../releases",
    "#release",
    "?release=2.1.1",
    "https:",
    "mailto:",
    "urn:",
    "web+demo:opaque",
    "release@internal",
    "release@例え",
    "release@xn--r8jz45g",
    "git@internal:owner/repo",
    "git@例え:owner/repo",
    "[v1.fe80::]",
    "release@[v1.fe80::]",
    "{https://example.test/release}",
    "[https://example.test/release]",
    "“https://example.test/release”",
    "«https://example.test/release»",
    "「https://example.test/release」",
    "（https://example.test/release）",
    "《{[https://example.test/release]}》",
    "&lpar;https://example.test/release&rpar;",
    "&#x300C;https://example.test/release&#x300D;",
    "**https://example.test/release**",
    "`https://example.test/release`",
    "[https://example.test/release](https://example.test/release)",
    "**h&#x34F;ttps://example.test/release**",
    "`h\u180Bttps://example.test/release`",
    "example.test;mailto:release@example.test",
    "example.test,127.1",
    "example.test|//other.example.test",
    "example.test&urn:example:release",
    "example.test+127.1",
    "example.test=localhost",
    "example.test~[::1]",
    "example.test_//other.example.test",
    "example.test…mailto:release@example.test",
    "example.test...mailto:release@example.test",
    "example.test\u0085mailto:release@example.test",
    "127.1\u001Fexample.test",
    "example.test\\\n  127.1",
    "localhost\\\n  localhost",
    "localhost![x](x.png)localhost",
    "**localhost**localhost",
    "localhost<!--c-->localhost",
    "h<!--c-->ttps://example.test/release",
    "**Node.js**https://example.test",
    "`Node.js`https://example.test",
    "[Node.js](https://docs.test)https://example.test",
    "Node.js<!--c-->https://example.test",
  ]) {
    assert.throws(
      () => validateVersionTexts({ ...base, changelog: `## ${VERSION} — 2026-07-20\n\n- ${note}` }),
      /substantive visible release-note text/,
    );
  }
  for (const note of [
    "Released https://example.test/releases/2.1.1",
    "See release notes at https://example.test/release",
    "See release notes at example.test/release",
    "See <https://example.test/releases/2.1.1> for details",
    "Report release issues to mailto:release@example.test",
    "[Release notes](https://example.test/releases/2.1.1)",
    "**Released** with `verified artifacts`",
    "Added `node:test` coverage for Node.js",
    "Improved Node.js and Deno 2 compatibility",
    "Added Node.js 22 support",
    "Use `--json` for machine-readable output",
    "Node.js",
    "**Node.js**",
    "`Node.js`",
    "React.js",
    "`node:test`",
    "`npm:@scope/package`",
    "Deno.land",
    "Fixed: https://example.test",
    "Docs: https://example.test",
    "Changed: example.test",
    "Release: /notes",
    "See: mailto:release@example.test",
    "Fixed:https://example.test",
    "Fixed—https://example.test",
    "Fixed(https://example.test)",
    "Release—example.test",
    "and/or",
    "TCP/IP",
    "CI/CD",
    "Node.js/Deno",
    "C++/Rust",
    "x86/x64",
    "node.js",
    "NODE.JS",
    "NoDe.Js",
    "`node:fs`",
    "`node:net`",
    "`node:fs/promises`",
    "`@scope/package`",
    "`npm:@scope/another-package`",
    "API: https://example.test",
    "CI: /notes",
    "API:https://example.test",
    "Vue.js",
    "Express.js",
    "C/C++",
    "Go/Rust",
    "client/server",
    "read/write",
    "Fixed:regression",
    "std::vector",
    "Promise.resolve",
    "producer/consumer",
    "Changed:parser",
    "Added:Node.js",
    "fix:parser",
    "tokio::spawn",
    "System.Text.Json",
    "ASP.NET",
    "react-dom/client",
    "sync/async",
    "HTTP/2",
    "TLS/1.3",
    "OAuth/OIDC",
    "Node.js\\\n  https://example.test",
    "Promise.resolve\\\n  https://example.test",
    "fixed\\\n  https://example.test",
    "Node.js![x](x.png)https://example.test",
    "**Node.js** https://example.test",
    "リリースの安定性を改善",
    "रिलीज़ की स्थिरता में सुधार",
  ]) {
    assert.equal(
      validateVersionTexts({ ...base, changelog: `## ${VERSION} — 2026-07-20\n\n- ${note}` }),
      VERSION,
    );
  }
  const section = parseChangelogSections(
    `## ${VERSION} — 2026-07-20\n\n> - Quoted\n\n\`\`\`md\n- Code\n\`\`\`\n\n- Released\n\n## Unreleased\n\n- Future`,
  ).find(({ version }) => version === VERSION);
  assert.deepEqual(section.notes, ["- Released"]);
  assert.equal(section.body.includes("Future"), false);
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

test("checksum generation and verification share UTF-8 byte order for mixed-case names", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dig-checksum-order-"));
  temporaryDirectories.add(directory);
  for (const name of ["release-metadata.json", "alpha.txt", "SOURCE_COMMIT", "Zebra.txt"]) {
    await writeFile(join(directory, name), `${name}\n`);
  }

  const assets = await localAssetManifest(directory);
  assert.deepEqual(
    assets.map(({ name }) => name),
    ["SOURCE_COMMIT", "Zebra.txt", "alpha.txt", "release-metadata.json"],
  );
  const line = ({ name, digest }) => `${digest.slice("sha256:".length)}  ${name}`;
  await writeFile(join(directory, "SHA256SUMS"), `${[...assets.slice(1), assets[0]].map(line).join("\n")}\n`);
  const wrongOrderManifest = await localAssetManifest(directory);
  await assert.rejects(
    () => verifyLocalChecksumManifest(directory, wrongOrderManifest),
    /exactly once in lexical order/,
  );

  await writeFile(join(directory, "SHA256SUMS"), `${assets.map(line).join("\n")}\n`);
  await verifyLocalChecksumManifest(directory, await localAssetManifest(directory));
});

async function candidateDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "dig-publisher-"));
  temporaryDirectories.add(directory);
  await writeFile(join(directory, "asset-a.txt"), "alpha");
  await writeFile(join(directory, "asset-b.txt"), "beta");
  const assets = await localAssetManifest(directory);
  await writeFile(
    join(directory, "SHA256SUMS"),
    assets.map(({ name, digest }) => `${digest.slice("sha256:".length)}  ${name}`).join("\n") + "\n",
  );
  return { directory, expected: await localAssetManifest(directory) };
}

function argument(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function formValue(args, key) {
  for (let index = 0; index < args.length - 1; index += 1) {
    if (!["-f", "-F"].includes(args[index])) continue;
    const value = args[index + 1];
    if (value.startsWith(`${key}=`)) return value.slice(key.length + 1);
  }
  return undefined;
}

function ok(body = "") {
  return { status: 0, stdout: typeof body === "string" ? body : JSON.stringify(body), stderr: "" };
}

function failed(message) {
  return { status: 1, stdout: "", stderr: message };
}

class FakeGitHub {
  constructor(expected, options = {}) {
    this.expected = expected;
    this.options = {
      ambiguousCreate: false,
      ambiguousPromotion: false,
      ambiguousUpload: false,
      branchContained: true,
      conflictingCreatedReleaseId: false,
      createVisibilityDelay: 0,
      defaultHead: COMMIT,
      duplicateRelease: false,
      failUpload: false,
      paginate: false,
      publishedImmutable: true,
      replaceDraftBeforeUpload: false,
      tagCommit: COMMIT,
      uploadUrl: undefined,
      wrongLatest: false,
      ...options,
    };
    this.calls = [];
    this.release = null;
    this.nextAssetId = 100;
    this.uploadCount = 0;
  }

  clone(value) {
    return value === null ? null : structuredClone(value);
  }

  remoteAssets(assets = this.expected) {
    return assets.map(({ name, digest, size }) => ({
      id: this.nextAssetId++,
      name,
      digest,
      size,
    }));
  }

  releaseList(endpoint) {
    const page = Number(new URL(`https://api.test/${endpoint}`).searchParams.get("page"));
    if (this.release && this.options.createVisibilityDelay > 0) {
      this.options.createVisibilityDelay -= 1;
      return [];
    }
    const releases = this.release ? [this.clone(this.release)] : [];
    if (this.options.conflictingCreatedReleaseId && releases.length === 1) releases[0].id += 1;
    if (this.options.duplicateRelease && this.release) {
      releases.push({ ...this.clone(this.release), id: this.release.id + 1 });
    }
    if (!this.options.paginate || !this.release) return releases;
    if (page === 1) {
      return Array.from({ length: 100 }, (_, index) => ({ id: 1_000 + index, tag_name: `v0.0.${index}` }));
    }
    return page === 2 ? releases : [];
  }

  api(args) {
    const endpoint = args[1];
    const method = argument(args, "--method") ?? "GET";
    if (/^repos\/owner\/repository\/releases\?/.test(endpoint) && method === "GET") {
      return ok(this.releaseList(endpoint));
    }
    if (endpoint === "repos/owner/repository" && method === "GET") return ok({ default_branch: "main" });
    if (endpoint === `repos/owner/repository/git/ref/tags/v${VERSION}` && method === "GET") {
      return ok({ object: { type: "commit", sha: this.options.tagCommit } });
    }
    if (endpoint === "repos/owner/repository/git/ref/heads/main" && method === "GET") {
      return ok({ object: { type: "commit", sha: this.options.defaultHead } });
    }
    if (endpoint === `repos/owner/repository/compare/${COMMIT}...${this.options.defaultHead}` && method === "GET") {
      return ok({
        status: this.options.branchContained ? "ahead" : "diverged",
        merge_base_commit: { sha: this.options.branchContained ? COMMIT : "c".repeat(40) },
      });
    }
    if (endpoint === "repos/owner/repository/releases" && method === "POST") {
      this.release = {
        id: 42,
        tag_name: formValue(args, "tag_name"),
        target_commitish: formValue(args, "target_commitish"),
        name: formValue(args, "name"),
        body: formValue(args, "body"),
        draft: true,
        prerelease: false,
        immutable: false,
        upload_url: this.options.uploadUrl
          ?? "https://uploads.github.com/repos/owner/repository/releases/42/assets{?name,label}",
        assets: [],
      };
      if (this.options.ambiguousCreate) {
        this.options.ambiguousCreate = false;
        return failed("connection reset after draft creation");
      }
      return ok(this.clone(this.release));
    }
    const byId = endpoint.match(/^repos\/owner\/repository\/releases\/(\d+)$/);
    if (byId && method === "GET") {
      if (!this.release || Number(byId[1]) !== this.release.id) return failed("HTTP 404: Not Found");
      const release = this.clone(this.release);
      if (this.options.returnWrongId) release.id += 1;
      return ok(release);
    }
    if (byId && method === "PATCH") {
      if (!this.release || Number(byId[1]) !== this.release.id) return failed("HTTP 404: Not Found");
      this.release.draft = false;
      this.release.immutable = this.options.publishedImmutable;
      if (this.options.ambiguousPromotion) {
        this.options.ambiguousPromotion = false;
        return failed("connection reset after publication");
      }
      return ok(this.clone(this.release));
    }
    const asset = endpoint.match(/^repos\/owner\/repository\/releases\/assets\/(\d+)$/);
    if (asset && method === "DELETE") {
      this.release.assets = this.release.assets.filter(({ id }) => id !== Number(asset[1]));
      return ok();
    }
    if (endpoint === "repos/owner/repository/releases/latest" && method === "GET") {
      return ok(this.options.wrongLatest
        ? { id: 7, tag_name: "v2.1.0" }
        : { id: this.release.id, tag_name: this.release.tag_name });
    }
    return failed(`Unexpected GitHub API call: ${method} ${endpoint}`);
  }

  run = (args) => {
    this.calls.push([...args]);
    if (args[0] === "api") return this.api(args);
    return failed(`Unexpected gh call: ${args.join(" ")}`);
  };

  upload = async ({ url, path }) => {
    this.calls.push(["upload", url, path]);
    const endpoint = new URL(url);
    const upload = endpoint.pathname.match(/^\/repos\/owner\/repository\/releases\/(\d+)\/assets$/);
    if (endpoint.protocol !== "https:" || endpoint.hostname !== "uploads.github.com" || !upload) {
      return failed(`Unexpected upload URL: ${url}`);
    }
    this.uploadCount += 1;
    if (this.options.replaceDraftBeforeUpload) {
      this.options.replaceDraftBeforeUpload = false;
      this.release = {
        id: 84,
        tag_name: `v${VERSION}`,
        target_commitish: COMMIT,
        name: "Foreign release",
        body: "Foreign draft body",
        draft: true,
        prerelease: false,
        immutable: false,
        upload_url: "https://uploads.github.com/repos/owner/repository/releases/84/assets{?name,label}",
        assets: [],
      };
      return failed("HTTP 404: verified draft was replaced");
    }
    if (!this.release || Number(upload[1]) !== this.release.id) return failed("HTTP 404: Not Found");
    const name = endpoint.searchParams.get("name");
    if (!name || [...endpoint.searchParams.keys()].some((key) => key !== "name")) return failed("Unexpected upload query");
    const expected = this.expected.find((asset) => asset.name === name);
    if (!expected) return failed(`Unexpected upload asset: ${name}`);
    if (basename(path) !== name) return failed(`Upload input does not match ${name}`);
    if (this.options.failUpload && this.uploadCount === 2) return failed("upload interrupted");
    const [uploaded] = this.remoteAssets([expected]);
    this.release.assets.push(uploaded);
    if (this.options.ambiguousUpload && this.release.assets.length === this.expected.length) {
      this.options.ambiguousUpload = false;
      return failed("connection reset after upload");
    }
    return ok(this.clone(uploaded));
  };
}

function publish(directory, fake, overrides = {}) {
  return publishReleaseCandidate({
    directory,
    tag: `v${VERSION}`,
    repository: "owner/repository",
    defaultBranch: "main",
    sourceCommit: COMMIT,
    eventName: "push",
    refType: "tag",
    publicationAuthorized: true,
    licensePresent: true,
    run: fake.run,
    upload: fake.upload,
    pause: async () => {},
    ...overrides,
  });
}

function isMutation(args) {
  if (args[0] === "upload") return true;
  if (args[0] !== "api") return false;
  return ["POST", "PATCH", "DELETE"].includes(argument(args, "--method"));
}

function releaseCreations(calls) {
  return calls.filter((args) => args[0] === "api"
    && args[1] === "repos/owner/repository/releases"
    && argument(args, "--method") === "POST").length;
}

test("publisher binds an exact contract and promotes only the verified immutable candidate", async () => {
  const { directory, expected } = await candidateDirectory();
  const fake = new FakeGitHub(expected);
  const published = await publish(directory, fake);
  assert.equal(published.draft, false);
  assert.equal(published.immutable, true);
  assert.match(published.body, /dig-release\/v1/);
  assert.match(published.body, new RegExp(COMMIT));
  assert.match(published.body, new RegExp(expected.find(({ name }) => name === "SHA256SUMS").digest));
  assert.equal(fake.calls.some((args) => args[0] === "release" && args[1] === "upload"), false);
  assert.ok(fake.calls.some((args) => args[0] === "upload"
    && args[1]?.startsWith("https://uploads.github.com/repos/owner/repository/releases/42/assets?name=")));
  assert.ok(fake.calls.some((args) => argument(args, "--method") === "PATCH"));
  assert.ok(fake.calls.some((args) => args[1] === "repos/owner/repository/releases/latest"));
  const drifted = fake.clone(published.assets);
  drifted[0].digest = `sha256:${"0".repeat(64)}`;
  assert.throws(() => verifyPublishedAssets(expected, drifted), /do not match/);
});

test("publisher recovers its paginated partial draft without creating a second release", async () => {
  const { directory, expected } = await candidateDirectory();
  const fake = new FakeGitHub(expected, { failUpload: true });
  await assert.rejects(() => publish(directory, fake), /left recoverable/);
  assert.equal(fake.release.draft, true);
  assert.equal(fake.release.assets.length, 1);
  const creations = () => releaseCreations(fake.calls);
  assert.equal(creations(), 1);

  fake.options.failUpload = false;
  fake.options.paginate = true;
  fake.options.defaultHead = "b".repeat(40);
  fake.options.branchContained = true;
  await publish(directory, fake);
  assert.equal(creations(), 1);
  assert.ok(fake.calls.some((args) => args[1]?.endsWith("page=2")));
  assert.ok(fake.calls.some((args) => argument(args, "--method") === "DELETE"));
});

test("publisher reconciles ambiguous create, upload, and promotion transitions", async () => {
  const { directory, expected } = await candidateDirectory();
  for (const option of ["ambiguousCreate", "ambiguousUpload", "ambiguousPromotion"]) {
    const fake = new FakeGitHub(expected, { [option]: true });
    const published = await publish(directory, fake);
    assert.equal(published.immutable, true, option);
    assert.equal(releaseCreations(fake.calls), 1, option);
  }
});

test("publisher waits for a newly created draft to become uniquely visible before upload", async () => {
  const { directory, expected } = await candidateDirectory();
  const fake = new FakeGitHub(expected, { createVisibilityDelay: 3 });
  const pauses = [];
  const published = await publish(directory, fake, { pause: async (milliseconds) => pauses.push(milliseconds) });

  assert.equal(published.immutable, true);
  assert.deepEqual(pauses, [1_000, 2_000, 4_000]);
  const firstUpload = fake.calls.findIndex((args) => args[0] === "upload");
  assert.ok(firstUpload > 0);
  const confirmationLists = fake.calls
    .slice(0, firstUpload)
    .filter((args) => args[0] === "api" && /^repos\/owner\/repository\/releases\?/.test(args[1]));
  assert.equal(confirmationLists.length, 5, "initial lookup plus four post-create confirmations");
});

test("publisher reconciles an ambiguous create after delayed visibility without creating twice", async () => {
  const { directory, expected } = await candidateDirectory();
  const fake = new FakeGitHub(expected, { ambiguousCreate: true, createVisibilityDelay: 2 });
  const pauses = [];
  const published = await publish(directory, fake, { pause: async (milliseconds) => pauses.push(milliseconds) });

  assert.equal(published.immutable, true);
  assert.deepEqual(pauses, [1_000, 2_000]);
  assert.equal(releaseCreations(fake.calls), 1);
});

test("publisher fails closed on duplicate, conflicting, or invisible post-create state", async () => {
  const { directory, expected } = await candidateDirectory();
  for (const [options, pattern, expectedPauses] of [
    [{ duplicateRelease: true }, /multiple releases/, []],
    [{ conflictingCreatedReleaseId: true }, /conflicting release ID/, []],
    [
      { createVisibilityDelay: 20 },
      /after 10 attempts/,
      [1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000, 10_000, 10_000],
    ],
  ]) {
    const fake = new FakeGitHub(expected, options);
    const pauses = [];
    await assert.rejects(
      () => publish(directory, fake, { pause: async (milliseconds) => pauses.push(milliseconds) }),
      pattern,
    );
    assert.deepEqual(pauses, expectedPauses);
    assert.equal(fake.uploadCount, 0);
    assert.equal(fake.release.draft, true);
    assert.deepEqual(fake.release.assets, []);
    assert.equal(fake.calls.filter(isMutation).length, 1, "only the draft creation may mutate state");
  }
});

test("publisher never mutates a foreign draft that replaces the verified draft before upload", async () => {
  const { directory, expected } = await candidateDirectory();
  const fake = new FakeGitHub(expected, { replaceDraftBeforeUpload: true });
  await assert.rejects(() => publish(directory, fake), /left recoverable|replaced/);
  assert.equal(fake.release.id, 84);
  assert.equal(fake.release.body, "Foreign draft body");
  assert.deepEqual(fake.release.assets, []);
  const foreignMutations = fake.calls.filter((args) => isMutation(args) && args[1]?.includes("/releases/84"));
  assert.deepEqual(foreignMutations, []);
  assert.ok(fake.calls.some((args) => isMutation(args)
    && args[1]?.startsWith("https://uploads.github.com/repos/owner/repository/releases/42/assets?name=")));
});

test("publisher rejects upload URLs not exactly bound to the verified GitHub draft", async () => {
  const { directory, expected } = await candidateDirectory();
  for (const [uploadUrl, pattern] of [
    ["http://uploads.github.com/repos/owner/repository/releases/42/assets{?name,label}", /must use HTTPS/],
    ["https://uploads.example.test/repos/owner/repository/releases/42/assets{?name,label}", /unexpected host/],
    ["https://uploads.github.com/repos/owner/repository/releases/84/assets{?name,label}", /verified repository and release ID/],
    ["https://uploads.github.com/repos/owner/repository/releases/42/assets?redirect=1{?name,label}", /unverified query/],
  ]) {
    const fake = new FakeGitHub(expected, { uploadUrl });
    await assert.rejects(() => publish(directory, fake), pattern);
    assert.equal(fake.calls.some((args) => args[0] === "upload"), false);
  }
});

test("publisher is mutation-free when the exact immutable release already exists", async () => {
  const { directory, expected } = await candidateDirectory();
  const fake = new FakeGitHub(expected);
  await publish(directory, fake);
  const mutationCount = fake.calls.filter(isMutation).length;
  fake.options.defaultHead = "b".repeat(40);
  fake.options.branchContained = true;
  await publish(directory, fake);
  assert.equal(fake.calls.filter(isMutation).length, mutationCount);
  assert.ok(fake.calls.some((args) => args[1]?.includes(`/compare/${COMMIT}...${"b".repeat(40)}`)));

  fake.release.body += "\nforeign edit";
  await assert.rejects(() => publish(directory, fake), /foreign or stale release contract/);
  assert.equal(fake.calls.filter(isMutation).length, mutationCount);
});

test("publisher rejects foreign, duplicate, stale-ID, and checksum-drifted release state", async () => {
  const { directory, expected } = await candidateDirectory();

  const foreign = new FakeGitHub(expected, { failUpload: true });
  await assert.rejects(() => publish(directory, foreign), /left recoverable/);
  foreign.options.failUpload = false;
  foreign.release.assets.push({ id: 999, name: "foreign.txt", digest: `sha256:${"f".repeat(64)}`, size: 7 });
  const beforeForeign = foreign.calls.filter(isMutation).length;
  await assert.rejects(() => publish(directory, foreign), /foreign asset/);
  assert.equal(foreign.calls.filter(isMutation).length, beforeForeign);

  const duplicate = new FakeGitHub(expected, { failUpload: true });
  await assert.rejects(() => publish(directory, duplicate), /left recoverable/);
  duplicate.options.duplicateRelease = true;
  await assert.rejects(() => publish(directory, duplicate), /multiple releases/);

  const wrongId = new FakeGitHub(expected);
  await publish(directory, wrongId);
  wrongId.options.returnWrongId = true;
  await assert.rejects(() => publish(directory, wrongId), /different release ID/);

  const checksumDrift = new FakeGitHub(expected);
  await publish(directory, checksumDrift);
  checksumDrift.release.assets[0].digest = `sha256:${"0".repeat(64)}`;
  await assert.rejects(() => publish(directory, checksumDrift), /do not match/);
});

test("publisher verifies remote tag and default-branch containment before any mutation", async () => {
  const { directory, expected } = await candidateDirectory();
  for (const options of [
    { tagCommit: "b".repeat(40) },
    { defaultHead: "b".repeat(40), branchContained: false },
  ]) {
    const fake = new FakeGitHub(expected, options);
    await assert.rejects(
      () => publish(directory, fake),
      /does not resolve|not contained/,
    );
    assert.equal(fake.calls.filter(isMutation).length, 0);
  }

  const advanced = new FakeGitHub(expected, { defaultHead: "b".repeat(40), branchContained: true });
  await publish(directory, advanced);
  assert.ok(advanced.calls.some((args) => args[1]?.includes(`/compare/${COMMIT}...`)));
});

test("publisher fails closed after a mutable or non-latest publication", async () => {
  const { directory, expected } = await candidateDirectory();
  for (const [options, pattern] of [
    [{ publishedImmutable: false }, /not immutable/],
    [{ wrongLatest: true }, /not the latest release/],
  ]) {
    const fake = new FakeGitHub(expected, options);
    await assert.rejects(() => publish(directory, fake), pattern);
    assert.equal(fake.release.draft, false);
    assert.equal(fake.calls.some((args) => argument(args, "--method") === "DELETE"), false);
  }
});

test("publisher checks authorization, license, event, and checksum manifest before GitHub access", async () => {
  const { directory, expected } = await candidateDirectory();
  for (const [overrides, pattern] of [
    [{ publicationAuthorized: false }, /static release policy/],
    [{ licensePresent: false }, /canonical MIT LICENSE/],
    [{ eventName: "workflow_dispatch" }, /tag-push event/],
    [{ refType: "branch" }, /tag-push event/],
  ]) {
    const fake = new FakeGitHub(expected);
    await assert.rejects(() => publish(directory, fake, overrides), pattern);
    assert.equal(fake.calls.length, 0);
  }

  const repositoryLicenseGate = new FakeGitHub(expected);
  await assert.rejects(
    () => publish(directory, repositoryLicenseGate, { root: directory, licensePresent: undefined }),
    /canonical MIT LICENSE/,
  );
  assert.equal(repositoryLicenseGate.calls.length, 0);

  await writeFile(join(directory, "LICENSE"), "not the approved license\n");
  const invalidRepositoryLicense = new FakeGitHub(expected);
  await assert.rejects(
    () => publish(directory, invalidRepositoryLicense, { root: directory, licensePresent: undefined }),
    /canonical MIT LICENSE/,
  );
  assert.equal(invalidRepositoryLicense.calls.length, 0);

  await writeFile(join(directory, "SHA256SUMS"), `${"0".repeat(64)}  asset-a.txt\n`);
  const fake = new FakeGitHub(await localAssetManifest(directory));
  await assert.rejects(() => publish(directory, fake), /bind every non-manifest asset/);
  assert.equal(fake.calls.length, 0);
});
