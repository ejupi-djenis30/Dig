import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseChangelogSections, validateMitLicenseText } from "./validate-release.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const stableTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const sourceCommitPattern = /^[0-9a-f]{40}$/;
const branchPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const checksumLinePattern = /^([0-9a-f]{64})  ([^/\\]+)$/;
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

async function uploadWithGitHubApi({ url, path }) {
  assert.ok(typeof process.env.GH_TOKEN === "string" && process.env.GH_TOKEN !== "", "GH_TOKEN is required for release asset upload.");
  const body = await readFile(path);
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        "Content-Type": "application/octet-stream",
        "X-GitHub-Api-Version": githubApiVersion,
      },
      body,
    });
    const responseBody = await response.text();
    return response.ok
      ? { status: 0, stdout: responseBody, stderr: "" }
      : { status: 1, stdout: "", stderr: `HTTP ${response.status}: ${responseBody}` };
  } catch (error) {
    return { status: 1, stdout: "", stderr: `Network error: ${error.message}` };
  }
}

function apiArguments(endpoint, additional = []) {
  return ["api", endpoint, "-H", `X-GitHub-Api-Version: ${githubApiVersion}`, ...additional];
}

function runChecked(args, run) {
  const result = run(args);
  if (result.status !== 0) throw commandError(args, result);
  return result;
}

function getJson({ endpoint, run, additional = [] }) {
  const args = apiArguments(endpoint, additional);
  const result = runChecked(args, run);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`GitHub returned invalid JSON for ${endpoint}: ${error.message}`);
  }
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
    const bytes = await readFile(path);
    manifest.push({
      name: entry.name,
      path,
      size: bytes.byteLength,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    });
  }
  return manifest;
}

async function verifyLocalChecksumManifest(directory, manifest) {
  const checksumAssets = manifest.filter(({ name }) => name === "SHA256SUMS");
  assert.equal(checksumAssets.length, 1, "Release candidate must contain exactly one SHA256SUMS asset.");
  const physicalLines = (await readFile(resolve(directory, "SHA256SUMS"), "utf8")).split(/\r?\n/);
  assert.equal(physicalLines.at(-1), "", "SHA256SUMS must end with one newline.");
  const lines = physicalLines.slice(0, -1);
  assert.ok(lines.length > 0, "SHA256SUMS must not be empty.");
  const entries = lines.map((line) => {
    const match = line.match(checksumLinePattern);
    assert.ok(match, `Malformed SHA256SUMS entry: ${line}`);
    return { digest: `sha256:${match[1]}`, name: match[2] };
  });
  const expected = manifest
    .filter(({ name }) => name !== "SHA256SUMS")
    .map(({ name, digest }) => ({ name, digest }));
  assert.deepEqual(entries, expected, "SHA256SUMS must bind every non-manifest asset exactly once in lexical order.");
  return checksumAssets[0];
}

function normalizedRemoteAssets(published) {
  assert.ok(Array.isArray(published), "GitHub did not return a release asset inventory.");
  const ids = new Set();
  const names = new Set();
  return published
    .map((asset) => {
      assert.ok(Number.isSafeInteger(asset?.id) && asset.id > 0, "GitHub returned an asset with an invalid ID.");
      assert.equal(ids.has(asset.id), false, `GitHub returned duplicate asset ID ${asset.id}.`);
      assert.equal(names.has(asset.name), false, `GitHub returned duplicate release asset ${asset.name}.`);
      ids.add(asset.id);
      names.add(asset.name);
      return { name: asset.name, digest: asset.digest, size: asset.size };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function verifyPublishedAssets(expected, published) {
  assert.deepEqual(
    normalizedRemoteAssets(published),
    expected.map(({ name, digest, size }) => ({ name, digest, size })),
    "Published release assets, sizes, or digests do not match the verified candidate.",
  );
}

function verifyRecoverableDraftAssets(expected, published) {
  assert.ok(Array.isArray(published), "GitHub did not return a draft asset inventory.");
  const expectedByName = new Map(expected.map((asset) => [asset.name, asset]));
  const ids = new Set();
  const names = new Set();
  for (const asset of published) {
    assert.ok(Number.isSafeInteger(asset?.id) && asset.id > 0, "GitHub draft contains an asset with an invalid ID.");
    assert.equal(ids.has(asset.id), false, `GitHub draft contains duplicate asset ID ${asset.id}.`);
    assert.equal(names.has(asset.name), false, `GitHub draft contains duplicate asset ${asset.name}.`);
    ids.add(asset.id);
    names.add(asset.name);
    const local = expectedByName.get(asset.name);
    assert.ok(local, `GitHub draft contains a foreign asset: ${asset.name}`);
    if (asset.digest !== null && asset.digest !== undefined) {
      assert.equal(asset.digest, local.digest, `GitHub draft contains a modified asset: ${asset.name}`);
    }
    if (asset.size !== null && asset.size !== undefined) {
      assert.equal(asset.size, local.size, `GitHub draft contains an asset with the wrong size: ${asset.name}`);
    }
  }
}

function validateReleaseIdentity(release, contract) {
  assert.ok(release && typeof release === "object" && !Array.isArray(release), "GitHub Release must be an object.");
  assert.ok(Number.isSafeInteger(release.id) && release.id > 0, "GitHub Release has an invalid ID.");
  assert.equal(release.tag_name, contract.tag, "GitHub Release returned the wrong tag.");
  assert.equal(release.target_commitish, contract.sourceCommit, "GitHub Release targets the wrong source commit.");
  assert.equal(release.name, contract.title, "GitHub Release has the wrong title.");
  assert.equal(release.body, contract.body, "GitHub Release has a foreign or stale release contract.");
  assert.equal(release.prerelease, false, "GitHub Release must not be a prerelease.");
  assert.ok(Array.isArray(release.assets), "GitHub Release is missing its asset inventory.");
}

function validateDraftRelease(release, contract) {
  validateReleaseIdentity(release, contract);
  assert.equal(release.draft, true, `Refusing to modify published release ${contract.tag}.`);
  assert.ok(typeof release.upload_url === "string" && release.upload_url !== "", "GitHub draft is missing its upload URL.");
}

function releaseAssetEndpoint({ release, repository }) {
  const suffix = "{?name,label}";
  assert.ok(release.upload_url.endsWith(suffix), "GitHub draft has an unsupported upload URL template.");
  const rawUrl = release.upload_url.slice(0, -suffix.length);
  let uploadUrl;
  try {
    uploadUrl = new URL(rawUrl);
  } catch (error) {
    throw new Error(`GitHub draft has an invalid upload URL: ${error.message}`);
  }
  assert.equal(uploadUrl.protocol, "https:", "GitHub draft upload URL must use HTTPS.");
  assert.equal(uploadUrl.hostname, "uploads.github.com", "GitHub draft upload URL has an unexpected host.");
  assert.equal(uploadUrl.port, "", "GitHub draft upload URL must not override the HTTPS port.");
  assert.equal(uploadUrl.username, "", "GitHub draft upload URL must not contain credentials.");
  assert.equal(uploadUrl.password, "", "GitHub draft upload URL must not contain credentials.");
  assert.equal(uploadUrl.search, "", "GitHub draft upload URL must not contain an unverified query.");
  assert.equal(uploadUrl.hash, "", "GitHub draft upload URL must not contain a fragment.");
  const pathname = `/repos/${repository}/releases/${release.id}/assets`;
  assert.equal(uploadUrl.pathname, pathname, "GitHub draft upload URL is not bound to the verified repository and release ID.");
  return rawUrl;
}

function validatePublishedRelease(release, contract) {
  validateReleaseIdentity(release, contract);
  assert.equal(release.draft, false, `GitHub Release ${contract.tag} remained a draft.`);
  assert.equal(release.immutable, true, `Published GitHub Release ${contract.tag} is not immutable.`);
}

function listReleaseForTag({ repository, tag, run }) {
  const matches = [];
  for (let page = 1; page <= 100; page += 1) {
    const releases = getJson({
      endpoint: `repos/${repository}/releases?per_page=100&page=${page}`,
      run,
    });
    assert.ok(Array.isArray(releases), "GitHub did not return a release list.");
    matches.push(...releases.filter((release) => release?.tag_name === tag));
    if (releases.length < 100) break;
    assert.notEqual(page, 100, "GitHub release pagination exceeded the supported limit.");
  }
  assert.ok(matches.length <= 1, `GitHub contains multiple releases for ${tag}; refusing ambiguous recovery.`);
  return matches[0];
}

function releaseById({ repository, releaseId, run }) {
  return getJson({ endpoint: `repos/${repository}/releases/${releaseId}`, run });
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
    assert.equal(visited.has(object.sha), false, `Remote tag ${tag} contains a tag-object cycle.`);
    visited.add(object.sha);
    object = getJson({ endpoint: `repos/${repository}/git/tags/${object.sha}`, run }).object;
  }
  throw new Error(`Remote tag ${tag} exceeds the supported annotated-tag depth.`);
}

function remoteBranchHead({ repository, branch, run }) {
  const ref = getJson({
    endpoint: `repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`,
    run,
  });
  assert.equal(ref?.object?.type, "commit", `Default branch ${branch} does not resolve directly to a commit.`);
  assert.match(ref.object.sha ?? "", sourceCommitPattern, `Default branch ${branch} has an invalid SHA.`);
  return ref.object.sha;
}

function requireCommitInBranch({ repository, sourceCommit, branchHead, run }) {
  if (branchHead === sourceCommit) return;
  const comparison = getJson({
    endpoint: `repos/${repository}/compare/${sourceCommit}...${branchHead}`,
    run,
  });
  assert.ok(
    ["ahead", "identical"].includes(comparison.status) && comparison.merge_base_commit?.sha === sourceCommit,
    `Verified source ${sourceCommit} is not contained in the current default branch.`,
  );
}

function requireRemoteSourceBinding({ repository, defaultBranch, tag, sourceCommit, run }) {
  assert.equal(
    resolveRemoteTag({ repository, tag, run }),
    sourceCommit,
    `Remote tag ${tag} does not resolve to the verified source commit.`,
  );
  const repositoryMetadata = getJson({ endpoint: `repos/${repository}`, run });
  assert.equal(repositoryMetadata.default_branch, defaultBranch, "Workflow default branch no longer matches GitHub repository metadata.");
  const before = remoteBranchHead({ repository, branch: defaultBranch, run });
  requireCommitInBranch({ repository, sourceCommit, branchHead: before, run });
  const after = remoteBranchHead({ repository, branch: defaultBranch, run });
  if (after !== before) requireCommitInBranch({ repository, sourceCommit, branchHead: after, run });
  assert.equal(
    resolveRemoteTag({ repository, tag, run }),
    sourceCommit,
    `Remote tag ${tag} changed during source verification.`,
  );
}

function requireRemoteTag({ repository, tag, sourceCommit, run, phase }) {
  assert.equal(
    resolveRemoteTag({ repository, tag, run }),
    sourceCommit,
    `Remote tag ${tag} changed during ${phase}.`,
  );
}

async function releaseContract({ root, tag, sourceCommit, checksumAsset }) {
  const version = tag.slice(1);
  const changelog = await readFile(resolve(root, "CHANGELOG.md"), "utf8");
  const sections = parseChangelogSections(changelog).filter((section) => section.version === version);
  assert.equal(sections.length, 1, `CHANGELOG.md must contain one ${version} section for release notes.`);
  const notes = sections[0].notes.join("\n\n").trim();
  assert.ok(notes !== "", "Release notes must contain a top-level CommonMark list.");
  const title = `DIG ${version}`;
  const body = [
    "## Changes",
    "",
    notes,
    "",
    "---",
    "Release provenance",
    "",
    "- Contract: `dig-release/v1`",
    `- Source commit: \`${sourceCommit}\``,
    `- Candidate manifest: \`${checksumAsset.digest}\``,
  ].join("\n");
  return { tag, title, body, sourceCommit };
}

function createDraftRelease({ repository, contract, run }) {
  return getJson({
    endpoint: `repos/${repository}/releases`,
    run,
    additional: [
      "--method", "POST",
      "-f", `tag_name=${contract.tag}`,
      "-f", `target_commitish=${contract.sourceCommit}`,
      "-f", `name=${contract.title}`,
      "-f", `body=${contract.body}`,
      "-F", "draft=true",
      "-F", "prerelease=false",
      "-F", "generate_release_notes=false",
    ],
  });
}

function deleteDraftAsset({ repository, releaseId, assetId, contract, run }) {
  const args = apiArguments(`repos/${repository}/releases/assets/${assetId}`, ["--method", "DELETE"]);
  const result = run(args);
  if (result.status === 0) return;
  const reconciled = releaseById({ repository, releaseId, run });
  validateDraftRelease(reconciled, contract);
  if (reconciled.assets.some((asset) => asset.id === assetId)) throw commandError(args, result);
}

function resetRecoverableDraft({ repository, release, contract, expected, run }) {
  const current = releaseById({ repository, releaseId: release.id, run });
  assert.equal(current.id, release.id, "GitHub returned a different release during draft recovery.");
  validateDraftRelease(current, contract);
  verifyRecoverableDraftAssets(expected, current.assets);
  for (const asset of current.assets) {
    deleteDraftAsset({ repository, releaseId: current.id, assetId: asset.id, contract, run });
  }
  const clean = releaseById({ repository, releaseId: current.id, run });
  validateDraftRelease(clean, contract);
  assert.equal(clean.assets.length, 0, `GitHub draft ${contract.tag} still has assets after reset.`);
  return clean;
}

function verifyDraftInventory({ repository, releaseId, contract, expected, run }) {
  const draft = releaseById({ repository, releaseId, run });
  assert.equal(draft.id, releaseId, "GitHub returned a different release during draft verification.");
  validateDraftRelease(draft, contract);
  verifyPublishedAssets(expected, draft.assets);
  return draft;
}

async function waitForDraftInventory({ repository, releaseId, contract, expected, run, pause }) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return verifyDraftInventory({ repository, releaseId, contract, expected, run });
    } catch (error) {
      lastError = error;
      if (attempt < 9) await pause(Math.min(2 ** attempt, 10) * 1000);
    }
  }
  throw lastError;
}

function parseJsonResult(endpoint, result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`GitHub returned invalid JSON for ${endpoint}: ${error.message}`);
  }
}

function validateUploadedAsset(uploaded, expected) {
  assert.ok(uploaded && typeof uploaded === "object" && !Array.isArray(uploaded), "GitHub returned an invalid uploaded asset.");
  assert.ok(Number.isSafeInteger(uploaded.id) && uploaded.id > 0, "GitHub returned an uploaded asset with an invalid ID.");
  assert.equal(uploaded.name, expected.name, "GitHub returned a different uploaded asset name.");
  if (uploaded.size !== null && uploaded.size !== undefined) {
    assert.equal(uploaded.size, expected.size, `GitHub uploaded ${expected.name} with the wrong size.`);
  }
  if (uploaded.digest !== null && uploaded.digest !== undefined) {
    assert.equal(uploaded.digest, expected.digest, `GitHub uploaded ${expected.name} with the wrong digest.`);
  }
}

async function uploadReleaseAssets({ release, repository, contract, expected, run, upload, pause }) {
  const releaseId = release.id;
  const current = releaseById({ repository, releaseId, run });
  assert.equal(current.id, releaseId, "GitHub returned a different release immediately before asset upload.");
  validateDraftRelease(current, contract);
  assert.equal(current.assets.length, 0, `GitHub draft ${contract.tag} is not empty immediately before upload.`);
  const endpointBase = releaseAssetEndpoint({ release: current, repository });

  for (const asset of expected) {
    const endpoint = `${endpointBase}?name=${encodeURIComponent(asset.name)}`;
    const result = await upload({ url: endpoint, path: asset.path });
    let failureDetail = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    if (result.status === 0) {
      try {
        validateUploadedAsset(parseJsonResult(endpoint, result), asset);
        continue;
      } catch (error) {
        failureDetail = `Ambiguous upload response: ${error.message}`;
      }
    }
    try {
      return await waitForDraftInventory({ repository, releaseId, contract, expected, run, pause });
    } catch (reconciliationError) {
      throw new Error(
        `GitHub asset upload failed for the verified release ID ${releaseId}: ${failureDetail}. The contract-bound draft was left recoverable; inventory reconciliation failed: ${reconciliationError.message}`,
        { cause: reconciliationError },
      );
    }
  }
  return waitForDraftInventory({ repository, releaseId, contract, expected, run, pause });
}

function verifyPublishedState({ repository, releaseId, contract, expected, run, requireLatest }) {
  const published = releaseById({ repository, releaseId, run });
  assert.equal(published.id, releaseId, "GitHub returned a different release ID after publication.");
  validatePublishedRelease(published, contract);
  verifyPublishedAssets(expected, published.assets);
  requireRemoteTag({
    repository,
    tag: contract.tag,
    sourceCommit: contract.sourceCommit,
    run,
    phase: "published-release verification",
  });
  if (requireLatest) {
    const latest = getJson({ endpoint: `repos/${repository}/releases/latest`, run });
    assert.equal(latest.id, releaseId, `Published release ${contract.tag} is not the latest release.`);
    assert.equal(latest.tag_name, contract.tag, "GitHub latest release points to the wrong tag.");
  }
  return published;
}

async function waitForPublishedState({ repository, releaseId, contract, expected, run, pause }) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return verifyPublishedState({ repository, releaseId, contract, expected, run, requireLatest: true });
    } catch (error) {
      lastError = error;
      if (attempt < 9) await pause(Math.min(2 ** attempt, 10) * 1000);
    }
  }
  throw lastError;
}

function checkedInLicenseExists(root) {
  const path = resolve(root, "LICENSE");
  let descriptor;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    descriptor = openSync(path, constants.O_RDONLY | noFollow);
    if (!fstatSync(descriptor).isFile()) return false;
    validateMitLicenseText(readFileSync(descriptor, "utf8"));
    return true;
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export async function publishReleaseCandidate({
  root = repositoryRoot,
  directory,
  tag,
  repository,
  defaultBranch,
  sourceCommit,
  eventName = process.env.GITHUB_EVENT_NAME,
  refType = process.env.GITHUB_REF_TYPE,
  publicationAuthorized = process.env.RELEASE_PUBLICATION_ENABLED === "true",
  licensePresent = checkedInLicenseExists(root),
  run = runGitHubCli,
  upload = uploadWithGitHubApi,
  pause = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
}) {
  assert.equal(publicationAuthorized, true, "Release publication is disabled by the repository's static release policy.");
  assert.equal(licensePresent, true, "Release publication requires the canonical MIT LICENSE file.");
  assert.equal(eventName, "push", "Release publication requires a trusted tag-push event.");
  assert.equal(refType, "tag", "Release publication requires a trusted tag-push event.");
  assert.match(tag, stableTagPattern, "Only stable v<major>.<minor>.<patch> tags may be published.");
  assert.match(repository, repositoryPattern, "Repository must use the owner/name form.");
  assert.match(defaultBranch, branchPattern, "Default branch contains unsupported characters.");
  assert.match(sourceCommit, sourceCommitPattern, "Source commit must be a lowercase 40-character SHA.");

  const expected = await localAssetManifest(directory);
  const checksumAsset = await verifyLocalChecksumManifest(directory, expected);
  const contract = await releaseContract({ root, tag, sourceCommit, checksumAsset });

  let release = listReleaseForTag({ repository, tag, run });
  if (release?.draft === false) {
    requireRemoteSourceBinding({ repository, defaultBranch, tag, sourceCommit, run });
    return verifyPublishedState({ repository, releaseId: release.id, contract, expected, run, requireLatest: false });
  }

  if (release) {
    validateDraftRelease(release, contract);
    requireRemoteSourceBinding({ repository, defaultBranch, tag, sourceCommit, run });
  } else {
    requireRemoteSourceBinding({ repository, defaultBranch, tag, sourceCommit, run });
    try {
      release = createDraftRelease({ repository, contract, run });
    } catch (createError) {
      try {
        release = listReleaseForTag({ repository, tag, run });
      } catch (reconciliationError) {
        throw new Error(`${createError.message}. Draft creation reconciliation failed: ${reconciliationError.message}`, {
          cause: reconciliationError,
        });
      }
      if (!release) throw createError;
      if (release.draft === false) {
        return verifyPublishedState({ repository, releaseId: release.id, contract, expected, run, requireLatest: false });
      }
    }
    validateDraftRelease(release, contract);
    const listed = listReleaseForTag({ repository, tag, run });
    assert.equal(listed?.id, release.id, "GitHub did not reconfirm the newly created draft by ID.");
    validateDraftRelease(listed, contract);
    release = listed;
  }

  release = resetRecoverableDraft({ repository, release, contract, expected, run });
  await uploadReleaseAssets({
    release,
    repository,
    contract,
    expected,
    run,
    upload,
    pause,
  });
  requireRemoteSourceBinding({ repository, defaultBranch, tag, sourceCommit, run });
  verifyDraftInventory({ repository, releaseId: release.id, contract, expected, run });
  requireRemoteTag({ repository, tag, sourceCommit, run, phase: "final pre-publication verification" });

  let transition;
  try {
    transition = getJson({
      endpoint: `repos/${repository}/releases/${release.id}`,
      run,
      additional: ["--method", "PATCH", "-F", "draft=false", "-f", "make_latest=true"],
    });
  } catch (transitionError) {
    const reconciled = releaseById({ repository, releaseId: release.id, run });
    if (reconciled.draft !== false) throw transitionError;
    transition = reconciled;
  }
  assert.equal(transition.id, release.id, "GitHub returned a different release during publication.");
  assert.equal(transition.draft, false, `GitHub did not publish release ${tag}.`);

  try {
    return await waitForPublishedState({
      repository,
      releaseId: release.id,
      contract,
      expected,
      run,
      pause,
    });
  } catch (error) {
    throw new Error(
      `Immutable release ${tag} was published but final verification failed; manual review is required: ${error.message}`,
      { cause: error },
    );
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
