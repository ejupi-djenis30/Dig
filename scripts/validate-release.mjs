import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sourceCommitPattern = /^[0-9a-f]{40}$/;

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
  assert.ok(changelog.includes(`## ${version} —`), `CHANGELOG.md must contain a dated ${version} heading.`);
  assert.ok(cli.includes(`process.stdout.write("DIG ${version}\\n")`), "The CLI version must match package.json.");
  if (tag !== undefined) assert.equal(tag, `v${version}`, `Release tag must be exactly v${version}.`);
  return version;
}

export async function validateReleaseMetadata({ root = repositoryRoot, tag } = {}) {
  const [packageJson, packageLockJson, changelog, cli] = await Promise.all([
    readFile(resolve(root, "package.json"), "utf8"),
    readFile(resolve(root, "package-lock.json"), "utf8"),
    readFile(resolve(root, "CHANGELOG.md"), "utf8"),
    readFile(resolve(root, "bin/dig.mjs"), "utf8"),
  ]);
  return validateVersionTexts({ packageJson, packageLockJson, changelog, cli, tag });
}

export async function validateReleaseBundle({ directory, version, sourceCommit }) {
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
  assert.ok(archive.byteLength > 2, "CLI archive is unexpectedly small.");
  assert.deepEqual([...archive.subarray(0, 2)], [0x1f, 0x8b], "CLI archive is not gzip data.");
  const sbom = JSON.parse(await readFile(resolve(directory, `dig-${version}.cdx.json`), "utf8"));
  assert.equal(sbom.bomFormat, "CycloneDX", "SBOM must use CycloneDX.");
  assert.equal(sbom.metadata?.component?.version, version, "SBOM version does not match the release.");
  assert.equal(sbom.serialNumber, undefined, "Normalized SBOM must not contain a random serial number.");
  assert.equal(sbom.metadata?.timestamp, undefined, "Normalized SBOM must not contain a build timestamp.");
  const dependencies = JSON.parse(
    await readFile(resolve(directory, `dig-npm-dependencies-${version}.json`), "utf8"),
  );
  assert.equal(dependencies.version, version, "Dependency evidence version does not match the release.");
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
