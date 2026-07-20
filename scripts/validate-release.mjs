import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { validateReleaseWorkflowText } from "./validate-release-workflow.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sourceCommitPattern = /^[0-9a-f]{40}$/;

function releaseHeadings(changelog) {
  const headings = [];
  let fence;
  let insideComment = false;
  for (const rawLine of changelog.split(/\r?\n/)) {
    if (fence) {
      const closingFence = rawLine.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (closingFence && closingFence[1][0] === fence.marker && closingFence[1].length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (insideComment) {
      if (rawLine.includes("-->")) insideComment = false;
      continue;
    }
    const openingFence = rawLine.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (openingFence) {
      const marker = openingFence[1][0];
      if (marker === "~" || !openingFence[2].includes("`")) {
        fence = { marker, length: openingFence[1].length };
        continue;
      }
    }
    let line = "";
    for (let index = 0; index < rawLine.length; ) {
      if (rawLine.startsWith("<!--", index)) {
        const commentEnd = rawLine.indexOf("-->", index + 4);
        if (commentEnd === -1) {
          insideComment = true;
          break;
        }
        index = commentEnd + 3;
      } else {
        line += rawLine[index];
        index += 1;
      }
    }
    const heading = line.match(/^## ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)) — (\d{4}-\d{2}-\d{2})\s*$/);
    if (heading) headings.push({ version: heading[1], date: heading[2] });
  }
  return headings;
}

function isCalendarDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function tarText(buffer, offset, length) {
  const end = buffer.indexOf(0, offset);
  return buffer.subarray(offset, end === -1 || end > offset + length ? offset + length : end).toString("utf8");
}

export function tarFiles(archive) {
  const tar = gunzipSync(archive, { maxOutputLength: 16 * 1024 * 1024 });
  const files = new Map();
  let terminated = false;
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      assert.ok(
        tar.subarray(offset).every((byte) => byte === 0),
        "Tar archive contains data after its end marker.",
      );
      terminated = true;
      break;
    }
    const name = `${tarText(header, 345, 155)}${tarText(header, 345, 155) ? "/" : ""}${tarText(header, 0, 100)}`;
    assert.ok(name && !name.startsWith("/") && !name.split("/").includes(".."), `Unsafe tar entry: ${name}`);
    const sizeText = tarText(header, 124, 12).trim();
    assert.match(sizeText, /^[0-7]+$/, `Invalid tar entry size: ${name}`);
    const size = Number.parseInt(sizeText, 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0, `Invalid tar entry size: ${name}`);
    const checksumText = tarText(header, 148, 8).trim();
    assert.match(checksumText, /^[0-7]+$/, `Invalid tar header checksum: ${name}`);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const checksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
    assert.equal(checksum, Number.parseInt(checksumText, 8), `Tar header checksum mismatch: ${name}`);
    const type = String.fromCharCode(header[156] || 0);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    assert.ok(contentEnd <= tar.length, `Truncated tar entry: ${name}`);
    assert.ok(type === "\0" || type === "0", `Unsupported tar entry type for ${name}.`);
    assert.ok(!files.has(name), `Duplicate tar entry: ${name}`);
    files.set(name, tar.subarray(contentStart, contentEnd));
    const nextOffset = contentStart + Math.ceil(size / 512) * 512;
    assert.ok(
      tar.subarray(contentEnd, nextOffset).every((byte) => byte === 0),
      `Tar entry has non-zero padding: ${name}`,
    );
    offset = nextOffset;
  }
  assert.equal(terminated, true, "Tar archive has no valid end marker.");
  return files;
}

function confinedPath(root, child) {
  const candidate = resolve(root, child);
  const pathFromRoot = relative(root, candidate);
  assert.ok(
    pathFromRoot !== "" && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`),
    `Release path escapes its root: ${child}`,
  );
  return candidate;
}

function releaseFileNames(version) {
  return [
    "SOURCE_COMMIT",
    `dig-${version}.cdx.json`,
    `dig-gopher-explorer-${version}.tgz`,
    `dig-npm-dependencies-${version}.json`,
    "release-metadata.json",
  ].sort();
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

export function validateVersionTexts({ packageJson, packageLockJson, changelog, cli, tag }) {
  const packageMetadata = JSON.parse(packageJson);
  const lockMetadata = JSON.parse(packageLockJson);
  const version = packageMetadata.version;

  assert.match(version, semanticVersionPattern, `Invalid stable semantic version: ${version}`);
  assert.equal(packageMetadata.name, "dig-gopher-explorer", "Unexpected package name.");
  assert.equal(packageMetadata.private, true, "The unlicensed package must remain private on npm.");
  assert.equal(packageMetadata.license, "UNLICENSED", "Package licensing metadata changed unexpectedly.");
  assert.equal(lockMetadata.version, version, "package-lock.json must match package.json.");
  assert.equal(lockMetadata.packages?.[""]?.version, version, "The lockfile root version must match package.json.");
  const matchingHeadings = releaseHeadings(changelog).filter((heading) => heading.version === version);
  assert.equal(matchingHeadings.length, 1, `CHANGELOG.md must contain one real, dated ${version} heading.`);
  assert.ok(isCalendarDate(matchingHeadings[0].date), `CHANGELOG.md contains an invalid date for ${version}.`);
  assert.ok(cli.includes(`process.stdout.write("DIG ${version}\\n")`), "The CLI version must match package.json.");
  if (tag !== undefined) assert.equal(tag, `v${version}`, `Release tag must be exactly v${version}.`);
  return version;
}

export async function validateReleaseMetadata({ root = repositoryRoot, tag } = {}) {
  const [packageJson, packageLockJson, changelog, cli, workflow] = await Promise.all([
    readFile(resolve(root, "package.json"), "utf8"),
    readFile(resolve(root, "package-lock.json"), "utf8"),
    readFile(resolve(root, "CHANGELOG.md"), "utf8"),
    readFile(resolve(root, "bin/dig.mjs"), "utf8"),
    readFile(resolve(root, ".github/workflows/release.yml"), "utf8"),
  ]);
  const version = validateVersionTexts({ packageJson, packageLockJson, changelog, cli, tag });
  validateReleaseWorkflowText(workflow);
  return version;
}

export async function validateReleaseBundle({ directory, version, sourceCommit, root = repositoryRoot }) {
  assert.match(version, semanticVersionPattern, "Release bundle version must be stable semantic versioning.");
  assert.match(sourceCommit, sourceCommitPattern, "Source commit must be a lowercase 40-character SHA.");
  const expectedFiles = releaseFileNames(version);
  const actualFiles = (await readdir(directory)).filter((entry) => entry !== "SHA256SUMS").sort();
  assert.deepEqual(actualFiles, expectedFiles, "Release bundle contains missing, stale, or unexpected files.");

  const checksumEntries = (await readFile(resolve(directory, "SHA256SUMS"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.match(/^([0-9a-f]{64})  ([^/\\]+)$/);
      assert.ok(match, `Malformed SHA256SUMS entry: ${line}`);
      return { digest: match[1], name: match[2] };
    });
  assert.deepEqual(
    checksumEntries.map(({ name }) => name),
    expectedFiles,
    "SHA256SUMS must list every release file exactly once in lexical order.",
  );
  for (const { digest, name } of checksumEntries) {
    assert.equal(await sha256(confinedPath(directory, name)), digest, `Checksum mismatch for ${name}.`);
  }

  assert.equal(await readFile(resolve(directory, "SOURCE_COMMIT"), "utf8"), `${sourceCommit}\n`);
  const metadata = JSON.parse(await readFile(resolve(directory, "release-metadata.json"), "utf8"));
  assert.deepEqual(metadata, {
    schemaVersion: 1,
    project: "DIG",
    version,
    tag: `v${version}`,
    sourceCommit,
    artifacts: {
      cliPackage: `dig-gopher-explorer-${version}.tgz`,
      sbom: `dig-${version}.cdx.json`,
      dependencyEvidence: `dig-npm-dependencies-${version}.json`,
    },
  });

  const archive = await readFile(resolve(directory, `dig-gopher-explorer-${version}.tgz`));
  assert.ok(archive.byteLength > 1024, "CLI archive is unexpectedly small.");
  assert.deepEqual([...archive.subarray(0, 2)], [0x1f, 0x8b], "CLI archive is not gzip data.");
  const packagedFiles = tarFiles(archive);
  const expectedPackageFiles = [
    "package/package.json",
    "package/bin/dig.mjs",
    "package/src/client.mjs",
    "package/src/output.mjs",
    "package/site/protocol.mjs",
    "package/CHANGELOG.md",
    "package/README.md",
    "package/SECURITY.md",
  ].sort();
  assert.deepEqual(
    [...packagedFiles.keys()].sort(),
    expectedPackageFiles,
    "CLI archive contains missing, stale, or unexpected files.",
  );
  for (const name of expectedPackageFiles) {
    const packaged = packagedFiles.get(name);
    assert.ok(packaged?.byteLength, `CLI archive is empty: ${name}.`);
    const sourcePath = name.replace(/^package\//, "");
    assert.deepEqual(
      packaged,
      await readFile(resolve(root, sourcePath)),
      `CLI archive content differs from the verified source: ${sourcePath}`,
    );
  }
  const packagedMetadata = JSON.parse(packagedFiles.get("package/package.json").toString("utf8"));
  assert.equal(packagedMetadata.name, "dig-gopher-explorer", "CLI archive has the wrong package name.");
  assert.equal(packagedMetadata.version, version, "CLI archive version does not match the release.");
  assert.equal(packagedMetadata.private, true, "The unlicensed CLI archive must remain private on npm.");
  assert.equal(packagedMetadata.license, "UNLICENSED", "CLI archive licensing metadata changed unexpectedly.");
  assert.equal(packagedMetadata.bin?.["dig-gopher"], "./bin/dig.mjs", "CLI archive has the wrong executable entry point.");
  assert.equal(packagedMetadata.dependencies, undefined, "CLI archive unexpectedly declares runtime dependencies.");
  const sbom = JSON.parse(await readFile(resolve(directory, `dig-${version}.cdx.json`), "utf8"));
  assert.equal(sbom.bomFormat, "CycloneDX", "SBOM must use CycloneDX.");
  assert.match(sbom.specVersion, /^1\.[5-9]$/, "SBOM must use a supported CycloneDX specification.");
  assert.equal(sbom.metadata?.component?.version, version, "SBOM version does not match the release.");
  const expectedPurl = `pkg:npm/dig-gopher-explorer@${version}`;
  assert.equal(sbom.metadata?.component?.purl, expectedPurl, "SBOM root component does not identify DIG.");
  assert.deepEqual(sbom.components, [], "SBOM must report the package's exact empty runtime component inventory.");
  assert.deepEqual(
    sbom.dependencies,
    [{ ref: sbom.metadata?.component?.["bom-ref"], dependsOn: [] }],
    "SBOM dependency graph must contain only the dependency-free root package.",
  );
  assert.equal(sbom.serialNumber, undefined, "Normalized SBOM must not contain a random serial number.");
  assert.equal(sbom.metadata?.timestamp, undefined, "Normalized SBOM must not contain a build timestamp.");
  const dependencies = JSON.parse(
    await readFile(resolve(directory, `dig-npm-dependencies-${version}.json`), "utf8"),
  );
  assert.equal(dependencies.name, "dig-gopher-explorer", "Dependency evidence has the wrong package name.");
  assert.equal(dependencies.version, version, "Dependency evidence version does not match the release.");
  assert.equal(dependencies.dependencies, undefined, "npm dependency evidence unexpectedly contains runtime packages.");
}

export async function assembleReleaseBundle({
  root = repositoryRoot,
  outputDirectory,
  sourceCommit,
  archive,
  sbom,
  dependencies,
}) {
  assert.match(sourceCommit, sourceCommitPattern, "Source commit must be a lowercase 40-character SHA.");
  const version = await validateReleaseMetadata({ root });
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  assert.equal((await readdir(output)).length, 0, `Release output directory is not empty: ${output}`);

  const inputs = new Map([
    [`dig-gopher-explorer-${version}.tgz`, resolve(archive)],
    [`dig-${version}.cdx.json`, resolve(sbom)],
    [`dig-npm-dependencies-${version}.json`, resolve(dependencies)],
  ]);
  for (const [name, source] of inputs) {
    assert.ok((await stat(source)).isFile(), `Release input is not a file: ${relative(root, source)}`);
    await copyFile(source, confinedPath(output, name));
  }

  await writeFile(resolve(output, "SOURCE_COMMIT"), `${sourceCommit}\n`, "utf8");
  const metadata = {
    schemaVersion: 1,
    project: "DIG",
    version,
    tag: `v${version}`,
    sourceCommit,
    artifacts: {
      cliPackage: `dig-gopher-explorer-${version}.tgz`,
      sbom: `dig-${version}.cdx.json`,
      dependencyEvidence: `dig-npm-dependencies-${version}.json`,
    },
  };
  await writeFile(resolve(output, "release-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  const checksums = [];
  for (const name of releaseFileNames(version)) {
    checksums.push(`${await sha256(confinedPath(output, name))}  ${name}`);
  }
  await writeFile(resolve(output, "SHA256SUMS"), `${checksums.join("\n")}\n`, "utf8");
  await validateReleaseBundle({ directory: output, version, sourceCommit });
  return version;
}

function parseArguments(args) {
  const allowedArguments = new Set([
    "--tag",
    "--assemble",
    "--commit",
    "--archive",
    "--sbom",
    "--dependencies",
    "--verify-bundle",
  ]);
  const parsed = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    assert.ok(allowedArguments.has(name), `Unknown argument: ${name}`);
    assert.ok(value && !value.startsWith("--"), `${name} requires a value.`);
    assert.ok(!parsed.has(name), `Argument supplied more than once: ${name}`);
    parsed.set(name, value);
  }
  return parsed;
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const parsed = parseArguments(process.argv.slice(2));
  const tag = parsed.get("--tag");
  const outputDirectory = parsed.get("--assemble");
  const verifyDirectory = parsed.get("--verify-bundle");
  const sourceCommit = parsed.get("--commit");
  if (outputDirectory) {
    for (const argument of ["--commit", "--archive", "--sbom", "--dependencies"]) {
      assert.ok(parsed.get(argument), `--assemble requires ${argument}.`);
    }
    const version = await assembleReleaseBundle({
      outputDirectory,
      sourceCommit,
      archive: parsed.get("--archive"),
      sbom: parsed.get("--sbom"),
      dependencies: parsed.get("--dependencies"),
    });
    console.log(`DIG ${version} release bundle validated.`);
  } else if (verifyDirectory) {
    assert.ok(sourceCommit, "--verify-bundle requires --commit.");
    const version = await validateReleaseMetadata({ tag });
    await validateReleaseBundle({ directory: resolve(verifyDirectory), version, sourceCommit });
    console.log(`DIG ${version} release bundle verified.`);
  } else {
    console.log(await validateReleaseMetadata({ tag }));
  }
}
