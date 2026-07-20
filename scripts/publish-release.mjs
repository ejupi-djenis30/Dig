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
const githubApiVersion = "2026-03-10";

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

function apiArguments(endpoint) {
  return ["api", "-H", `X-GitHub-Api-Version: ${githubApiVersion}`, endpoint];
}

function getJson({ endpoint, run }) {
  const args = apiArguments(endpoint);
  const result = run(args);
  if (result.status !== 0) throw commandError(args, result);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`GitHub returned invalid JSON for ${endpoint}: ${error.message}`);
  }
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

function verifyDraftAssetsBelongToCandidate(expected, published) {
  assert.ok(Array.isArray(published), "GitHub did not return a draft asset inventory.");
  const expectedByName = new Map(expected.map(({ name, digest }) => [name, digest]));
  for (const { name, digest } of published) {
    const expectedDigest = expectedByName.get(name);
    assert.ok(
      expectedDigest && (digest === expectedDigest || digest === null || digest === undefined),
      `Refusing to delete a draft containing an unknown or modified asset: ${name}`,
    );
  }
}

function viewRelease({ tag, repository, fields, run }) {
  const args = ["release", "view", tag, "--repo", repository, "--json", fields.join(",")];
  const result = run(args);
  if (result.status !== 0) return { args, result };
  try {
    return { args, result, release: JSON.parse(result.stdout) };
  } catch (error) {
    throw new Error(`GitHub returned invalid release JSON for ${tag}: ${error.message}`);
  }
}

async function waitForVerifiedDraft({ tag, repository, expected, run, pause }) {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const viewed = viewRelease({
      tag,
      repository,
      fields: ["assets", "databaseId", "isDraft", "tagName"],
      run,
    });
    try {
      if (!viewed.release) throw commandError(viewed.args, viewed.result);
      assert.equal(viewed.release.tagName, tag, "GitHub returned the wrong release tag.");
      assert.equal(viewed.release.isDraft, true, "The release candidate must remain a draft during verification.");
      assert.ok(Number.isSafeInteger(viewed.release.databaseId), "GitHub did not return a numeric release ID.");
      verifyPublishedAssets(expected, viewed.release.assets);
      return viewed.release.databaseId;
    } catch (error) {
      lastError = error;
      if (attempt < 11) await pause(Math.min(2 ** attempt, 10) * 1000);
    }
  }
  throw lastError;
}

function deleteVerifiedDraft({ tag, repository, expected, run }) {
  const viewed = viewRelease({
    tag,
    repository,
    fields: ["assets", "isDraft", "tagName"],
    run,
  });
  if (!viewed.release) {
    return missingRelease(viewed.result) ? undefined : commandError(viewed.args, viewed.result);
  }
  try {
    assert.equal(viewed.release.tagName, tag, `Refusing to delete a release other than ${tag}.`);
    assert.equal(viewed.release.isDraft, true, `Refusing to delete ${tag} because it is no longer a draft.`);
    verifyDraftAssetsBelongToCandidate(expected, viewed.release.assets);
  } catch (error) {
    return error;
  }
  const deleteArguments = ["release", "delete", tag, "--repo", repository, "--yes"];
  const deleted = run(deleteArguments);
  return deleted.status === 0 ? undefined : commandError(deleteArguments, deleted);
}

function requireCurrentDefaultBranch({ repository, defaultBranch, sourceCommit, run }) {
  const commit = getJson({
    endpoint: `repos/${repository}/commits/${encodeURIComponent(defaultBranch)}`,
    run,
  });
  assert.equal(
    commit.sha,
    sourceCommit,
    `Tagged source ${sourceCommit} is no longer the current ${defaultBranch} commit.`,
  );
}

function resolveRemoteTag({ repository, tag, run }) {
  let object = getJson({
    endpoint: `repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`,
    run,
  }).object;
  const visited = new Set();
  for (let depth = 0; depth < 8; depth += 1) {
    assert.ok(object && typeof object === "object", `Remote tag ${tag} has no target object.`);
    assert.match(object.sha ?? "", sourceCommitPattern, `Remote tag ${tag} has an invalid target SHA.`);
    if (object.type === "commit") return object.sha;
    assert.equal(object.type, "tag", `Remote tag ${tag} targets unsupported object type ${object.type}.`);
    assert.ok(!visited.has(object.sha), `Remote tag ${tag} contains a tag-object cycle.`);
    visited.add(object.sha);
    object = getJson({ endpoint: `repos/${repository}/git/tags/${object.sha}`, run }).object;
  }
  throw new Error(`Remote tag ${tag} exceeds the supported annotated-tag depth.`);
}

function requireSourceBinding({ repository, defaultBranch, tag, sourceCommit, run }) {
  requireCurrentDefaultBranch({ repository, defaultBranch, sourceCommit, run });
  assert.equal(
    resolveRemoteTag({ repository, tag, run }),
    sourceCommit,
    `Remote tag ${tag} does not resolve to the verified source commit.`,
  );
}

async function waitForPublishedRelease({ releaseId, tag, repository, expected, run, pause }) {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const release = getJson({ endpoint: `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, run });
      const latest = getJson({ endpoint: `repos/${repository}/releases/latest`, run });
      assert.equal(release.id, releaseId, "GitHub returned a different release after promotion.");
      assert.equal(release.tag_name, tag, "GitHub returned the wrong published tag.");
      assert.equal(release.draft, false, "GitHub release remained a draft.");
      assert.equal(release.immutable, true, "Published GitHub release is not immutable.");
      assert.equal(latest.id, releaseId, "GitHub release was not promoted to latest.");
      assert.equal(latest.tag_name, tag, "GitHub latest release points to the wrong tag.");
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
  requireSourceBinding({ repository, defaultBranch, tag, sourceCommit, run });

  const existing = viewRelease({ tag, repository, fields: ["tagName"], run });
  if (existing.release) throw new Error(`Release ${tag} already exists; releases are immutable.`);
  if (!missingRelease(existing.result)) throw commandError(existing.args, existing.result);

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

  let promoted = false;
  try {
    const created = run(createArguments);
    if (created.status !== 0) throw commandError(createArguments, created);

    const releaseId = await waitForVerifiedDraft({ tag, repository, expected, run, pause });
    requireSourceBinding({ repository, defaultBranch, tag, sourceCommit, run });
    const promotionArguments = [
      "release",
      "edit",
      tag,
      "--repo",
      repository,
      "--draft=false",
      "--latest",
    ];
    const promotionResult = run(promotionArguments);
    if (promotionResult.status !== 0) throw commandError(promotionArguments, promotionResult);
    promoted = true;

    await waitForPublishedRelease({ releaseId, tag, repository, expected, run, pause });
  } catch (error) {
    if (!promoted) {
      const cleanupError = deleteVerifiedDraft({ tag, repository, expected, run });
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
