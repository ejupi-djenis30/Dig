import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const stableTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const sourceCommitPattern = /^[0-9a-f]{40}$/;
const branchPattern = /^[A-Za-z0-9._/-]+$/;

function commandError(args, result) {
  const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim();
  return new Error(`gh ${args.join(" ")} failed: ${detail}`);
}

function runGitHubCli(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  return result;
}

function missingRelease(result) {
  return result.status !== 0 && /(?:HTTP\s+404(?:: Not Found)?|release not found|release does not exist)/i.test(`${result.stderr}\n${result.stdout}`);
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function localAssetManifest(directory) {
  const root = resolve(directory);
  const entries = await readdir(root, { withFileTypes: true });
  assert.ok(entries.length > 0, "The release candidate contains no assets.");
  const manifest = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    assert.ok(entry.isFile(), `Release assets must be regular files: ${entry.name}`);
    const path = resolve(root, entry.name);
    assert.equal(basename(path), entry.name, `Unsafe release asset name: ${entry.name}`);
    manifest.push({ name: entry.name, path, digest: `sha256:${await sha256(path)}` });
  }
  return manifest;
}

export function verifyPublishedAssets(expected, published) {
  assert.ok(Array.isArray(published), "GitHub did not return a release asset inventory.");
  const normalized = published
    .map(({ name, digest }) => ({ name, digest }))
    .sort((left, right) => left.name.localeCompare(right.name));
  assert.deepEqual(
    normalized,
    expected.map(({ name, digest }) => ({ name, digest })),
    "Published release assets or digests do not match the verified candidate.",
  );
}

async function waitForVerifiedDraft({ tag, repository, expected, run, pause }) {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = run([
      "release",
      "view",
      tag,
      "--repo",
      repository,
      "--json",
      "assets,isDraft,tagName",
    ]);
    try {
      if (result.status !== 0) throw commandError(["release", "view", tag], result);
      const release = JSON.parse(result.stdout);
      assert.equal(release.tagName, tag, "GitHub returned the wrong release tag.");
      assert.equal(release.isDraft, true, "The release candidate must remain a draft during verification.");
      verifyPublishedAssets(expected, release.assets);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 11) await pause(Math.min(2 ** attempt, 10) * 1000);
    }
  }
  throw lastError;
}

function deleteVerifiedDraft({ tag, repository, run }) {
  const viewArguments = ["release", "view", tag, "--repo", repository, "--json", "isDraft,tagName"];
  const viewed = run(viewArguments);
  if (viewed.status !== 0) return commandError(viewArguments, viewed);
  const release = JSON.parse(viewed.stdout);
  if (release.tagName !== tag || release.isDraft !== true) {
    return new Error(`Refusing to delete ${tag} because GitHub no longer reports it as that exact draft.`);
  }
  const deleteArguments = ["release", "delete", tag, "--repo", repository, "--yes"];
  const deleted = run(deleteArguments);
  return deleted.status === 0 ? undefined : commandError(deleteArguments, deleted);
}

function requireCurrentDefaultBranch({ repository, defaultBranch, sourceCommit, run }) {
  const argumentsList = [
    "api",
    `repos/${repository}/commits/${encodeURIComponent(defaultBranch)}`,
    "--jq",
    ".sha",
  ];
  const result = run(argumentsList);
  if (result.status !== 0) throw commandError(argumentsList, result);
  assert.equal(
    result.stdout.trim(),
    sourceCommit,
    `Tagged source ${sourceCommit} is no longer the current ${defaultBranch} commit.`,
  );
}

async function waitForPublishedRelease({ tag, repository, expected, run, pause }) {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const argumentsList = [
      "release",
      "view",
      tag,
      "--repo",
      repository,
      "--json",
      "assets,isDraft,isLatest,tagName",
    ];
    const result = run(argumentsList);
    try {
      if (result.status !== 0) throw commandError(argumentsList, result);
      const release = JSON.parse(result.stdout);
      assert.equal(release.tagName, tag, "GitHub returned the wrong published tag.");
      assert.equal(release.isDraft, false, "GitHub release remained a draft.");
      assert.equal(release.isLatest, true, "GitHub release was not promoted to latest.");
      verifyPublishedAssets(expected, release.assets);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 11) await pause(Math.min(2 ** attempt, 10) * 1000);
    }
  }
  throw lastError;
}

export async function publishReleaseCandidate({
  directory,
  tag,
  repository,
  defaultBranch,
  sourceCommit,
  run = runGitHubCli,
  pause = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
}) {
  assert.match(tag, stableTagPattern, "Only stable v<major>.<minor>.<patch> tags may be published.");
  assert.match(repository, repositoryPattern, "Repository must use the owner/name form.");
  assert.match(defaultBranch, branchPattern, "Default branch contains unsupported characters.");
  assert.match(sourceCommit, sourceCommitPattern, "Source commit must be a lowercase 40-character SHA.");
  const expected = await localAssetManifest(directory);
  requireCurrentDefaultBranch({ repository, defaultBranch, sourceCommit, run });

  const existing = run(["release", "view", tag, "--repo", repository, "--json", "tagName"]);
  if (existing.status === 0) throw new Error(`Release ${tag} already exists; releases are immutable.`);
  if (!missingRelease(existing)) throw commandError(["release", "view", tag], existing);

  const version = tag.slice(1);
  const createArguments = [
    "release",
    "create",
    tag,
    ...expected.map(({ path }) => path),
    "--repo",
    repository,
    "--draft",
    "--verify-tag",
    "--title",
    `DIG ${version}`,
    "--generate-notes",
  ];
  const created = run(createArguments);
  if (created.status !== 0) throw commandError(createArguments, created);

  let promoted = false;
  try {
    await waitForVerifiedDraft({ tag, repository, expected, run, pause });
    requireCurrentDefaultBranch({ repository, defaultBranch, sourceCommit, run });
    const promotionResult = run([
      "release",
      "edit",
      tag,
      "--repo",
      repository,
      "--draft=false",
      "--latest",
    ]);
    if (promotionResult.status !== 0) throw commandError(["release", "edit", tag], promotionResult);
    promoted = true;

    await waitForPublishedRelease({ tag, repository, expected, run, pause });
  } catch (error) {
    if (!promoted) {
      const cleanupError = deleteVerifiedDraft({ tag, repository, run });
      if (cleanupError) error.message += ` Cleanup also failed: ${cleanupError.message}`;
    }
    throw error;
  }
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    assert.ok(
      ["--directory", "--tag", "--repository", "--default-branch", "--source-commit"].includes(name),
      `Unknown argument: ${name}`,
    );
    assert.ok(value && !value.startsWith("--"), `${name} requires a value.`);
    assert.ok(!values.has(name), `${name} was supplied more than once.`);
    values.set(name, value);
  }
  for (const required of ["--directory", "--tag", "--repository", "--default-branch", "--source-commit"]) {
    assert.ok(values.has(required), `${required} is required.`);
  }
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = parseArguments(process.argv.slice(2));
  await publishReleaseCandidate({
    directory: args.get("--directory"),
    tag: args.get("--tag"),
    repository: args.get("--repository"),
    defaultBranch: args.get("--default-branch"),
    sourceCommit: args.get("--source-commit"),
  });
}
