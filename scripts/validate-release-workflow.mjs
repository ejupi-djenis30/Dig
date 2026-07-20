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
  assert.match(workflow, /^permissions:\n  contents: read$/m, "Workflow defaults must grant read-only contents permission.");
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
