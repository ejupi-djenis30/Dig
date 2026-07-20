import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const workflowPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/;
const commitPattern = /^[0-9a-f]{40}$/;
const tagRefPattern = /^refs\/tags\/v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function runGitHubCli(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  return result;
}

function commandError(args, result) {
  const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim();
  return new Error(`gh ${args.join(" ")} failed: ${detail}`);
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export function parseChecksumManifest(text) {
  const entries = text
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.match(/^([0-9a-f]{64})  ([^/\\]+)$/);
      assert.ok(match, `Malformed checksum entry: ${line}`);
      assert.equal(basename(match[2]), match[2], `Unsafe checksum path: ${match[2]}`);
      return { digest: match[1], name: match[2] };
    });
  assert.ok(entries.length > 0, "Checksum manifest is empty.");
  assert.deepEqual(
    entries.map(({ name }) => name),
    [...entries.map(({ name }) => name)].sort(),
    "Checksum manifest must use lexical order.",
  );
  assert.equal(new Set(entries.map(({ name }) => name)).size, entries.length, "Checksum manifest contains duplicates.");
  return entries;
}

export async function verifyReleaseAttestations({
  directory,
  repository,
  signerWorkflow,
  sourceCommit,
  sourceRef,
  run = runGitHubCli,
  pause = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
}) {
  assert.match(repository, repositoryPattern, "Repository must use the owner/name form.");
  assert.match(signerWorkflow, workflowPattern, "Signer workflow must identify a workflow in owner/repository.");
  assert.ok(signerWorkflow.startsWith(`${repository}/`), "Signer workflow repository does not match the source repository.");
  assert.match(sourceCommit, commitPattern, "Source commit must be a lowercase 40-character SHA.");
  assert.match(sourceRef, tagRefPattern, "Attestations may be verified only for a stable tag ref.");

  const root = resolve(directory);
  const checksumPath = resolve(root, "SHA256SUMS");
  const entries = parseChecksumManifest(await readFile(checksumPath, "utf8"));
  entries.push({ digest: await sha256(checksumPath), name: "SHA256SUMS" });
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    assert.equal(await sha256(path), entry.digest, `Local artifact changed after attestation: ${entry.name}`);
    const argumentsList = [
      "attestation",
      "verify",
      path,
      "--repo",
      repository,
      "--signer-workflow",
      signerWorkflow,
      "--source-digest",
      sourceCommit,
      "--source-ref",
      sourceRef,
      "--predicate-type",
      "https://slsa.dev/provenance/v1",
      "--cert-oidc-issuer",
      "https://token.actions.githubusercontent.com",
      "--deny-self-hosted-runners",
      "--format",
      "json",
    ];
    let lastError;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = run(argumentsList);
      try {
        if (result.status !== 0) throw commandError(argumentsList, result);
        const verified = JSON.parse(result.stdout);
        assert.ok(Array.isArray(verified) && verified.length > 0, `No verified attestation returned for ${entry.name}.`);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 7) await pause(Math.min(2 ** attempt, 10) * 1000);
      }
    }
    if (lastError) throw lastError;
  }
}

function parseArguments(args) {
  const allowed = new Set(["--directory", "--repository", "--signer-workflow", "--source-commit", "--source-ref"]);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    assert.ok(allowed.has(name), `Unknown argument: ${name}`);
    assert.ok(value && !value.startsWith("--"), `${name} requires a value.`);
    assert.ok(!values.has(name), `${name} was supplied more than once.`);
    values.set(name, value);
  }
  for (const name of allowed) assert.ok(values.has(name), `${name} is required.`);
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = parseArguments(process.argv.slice(2));
  await verifyReleaseAttestations({
    directory: args.get("--directory"),
    repository: args.get("--repository"),
    signerWorkflow: args.get("--signer-workflow"),
    sourceCommit: args.get("--source-commit"),
    sourceRef: args.get("--source-ref"),
  });
}
