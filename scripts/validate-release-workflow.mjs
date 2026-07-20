import assert from "node:assert/strict";

function jobBlock(workflow, name) {
  const lines = workflow.split(/\r?\n/);
  const header = `  ${name}:`;
  const start = lines.findIndex((line) => line === header);
  assert.notEqual(start, -1, `Release workflow is missing the ${name} job.`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

export function validateReleaseWorkflowText(workflow) {
  assert.doesNotMatch(workflow, /^\s*pull_request_target:/m, "Release workflow must not use pull_request_target.");
  const activeLines = workflow
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"));
  const actionReferences = activeLines
    .map((line) => line.match(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/)?.[1])
    .filter(Boolean);
  assert.ok(actionReferences.length > 0, "Release workflow contains no actions.");
  for (const reference of actionReferences) {
    assert.match(
      reference,
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/,
      `Release action must be pinned to a full commit SHA: ${reference}`,
    );
  }

  const build = jobBlock(workflow, "build");
  const publish = jobBlock(workflow, "publish");
  const topLevelPermissions = workflow.match(/^permissions:\r?\n((?:  [^\r\n]+\r?\n?)*)/m);
  assert.ok(topLevelPermissions, "Release workflow must declare top-level permissions.");
  assert.deepEqual(
    topLevelPermissions[1].split(/\r?\n/).filter(Boolean).map((line) => line.trim()),
    ["contents: read"],
    "Workflow defaults must grant only read-only contents permission.",
  );
  assert.deepEqual(
    workflow.match(/^    runs-on: .+$/gm),
    ["    runs-on: ubuntu-24.04", "    runs-on: ubuntu-24.04"],
    "Release jobs must use the pinned Ubuntu runner line.",
  );
  assert.deepEqual(
    workflow.match(/^          node-version: .+$/gm),
    ['          node-version: "22.23.1"', '          node-version: "22.23.1"'],
    "Release jobs must use the exact supported Node.js runtime.",
  );
  assert.equal(
    (workflow.match(/\[\[ "\$\(npm --version\)" == "10\.9\.8" \]\]/g) ?? []).length,
    2,
    "Release jobs must verify the npm version bundled with the pinned Node.js runtime.",
  );
  assert.doesNotMatch(build, /^\s+id-token:/m, "Build job must not receive an OIDC token.");
  assert.doesNotMatch(build, /^    permissions:/m, "Build job must not override the read-only workflow permissions.");
  assert.match(
    publish,
    /^    if: github\.event_name == 'push' && github\.ref_type == 'tag'$/m,
    "Publish job must run only for a tag push.",
  );
  const permissionLines = publish
    .split(/\r?\n/)
    .filter((line) => /^      [a-z-]+: (?:read|write|none)$/.test(line))
    .map((line) => line.trim())
    .sort();
  assert.deepEqual(permissionLines, [
    "artifact-metadata: write",
    "attestations: write",
    "contents: write",
    "id-token: write",
  ], "Publish permissions changed unexpectedly.");

  const attestation = publish.indexOf("uses: actions/attest@");
  const verification = publish.indexOf("node scripts/verify-attestations.mjs");
  const publication = publish.indexOf("node scripts/publish-release.mjs");
  const ghInstallation = publish.indexOf("name: Install verified GitHub CLI");
  assert.ok(ghInstallation >= 0, "Publish job must install a checksummed GitHub CLI.");
  assert.ok(ghInstallation < verification, "The verified GitHub CLI must be installed before provenance verification.");
  assert.ok(publish.includes('GH_CLI_VERSION: "2.94.0"'), "GitHub CLI version changed unexpectedly.");
  assert.ok(
    publish.includes('GH_CLI_SHA256: "a757f1ba6db18f4de8cbadb244843a5f89bc75b5e7c6fc127d2bd77fbd12ed62"'),
    "GitHub CLI checksum changed unexpectedly.",
  );
  assert.ok(publish.includes("sha256sum --check --strict"), "GitHub CLI archive must be checksum-verified.");
  assert.ok(publish.includes('>> "${GITHUB_PATH}"'), "Verified GitHub CLI must be placed on the workflow path.");
  assert.ok(attestation >= 0, "Publish job must create GitHub attestations.");
  assert.ok(verification > attestation, "Attestations must be verified after creation.");
  assert.ok(publication > verification, "Release publication must happen after provenance verification.");
  for (const required of [
    "--default-branch \"${{ github.event.repository.default_branch }}\"",
    "--source-commit \"${{ steps.source.outputs.source_commit }}\"",
    "--source-ref \"${{ github.ref }}\"",
    "--signer-workflow \"${{ github.repository }}/.github/workflows/release.yml\"",
  ]) {
    assert.ok(publish.includes(required), `Release workflow is missing binding: ${required}`);
  }
}
