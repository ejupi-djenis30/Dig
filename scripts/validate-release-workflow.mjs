import assert from "node:assert/strict";

function jobBlock(workflow, name) {
  const lines = workflow.split(/\r?\n/);
  const header = `  ${name}:`;
  const starts = lines.flatMap((line, index) => line === header ? [index] : []);
  assert.equal(starts.length, 1, `Release workflow must declare exactly one ${name} job.`);
  const start = starts[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function mappingEntries(
  scope,
  name,
  indentation,
  label,
  { keyPattern = "[a-z-]+", valuePattern = "(?:read|write|none)" } = {},
) {
  const lines = scope.split(/\r?\n/);
  const prefix = " ".repeat(indentation);
  const declarationPattern = new RegExp(`^${prefix}${name}(?:\\s*:.*)$`);
  const starts = lines.flatMap((line, index) => declarationPattern.test(line) ? [index] : []);
  assert.equal(starts.length, 1, `${label} must declare exactly one ${name} mapping.`);
  assert.equal(lines[starts[0]], `${prefix}${name}:`, `${label} ${name} must be an explicit mapping, not a scalar or alias.`);
  const entries = [];
  for (let index = starts[0] + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const entryIndentation = line.match(/^ */)[0].length;
    if (entryIndentation <= indentation) break;
    assert.equal(entryIndentation, indentation + 2, `Unsupported nested ${label} ${name} entry: ${line.trim()}`);
    const entry = line.match(new RegExp(
      `^${" ".repeat(indentation + 2)}(${keyPattern}): (${valuePattern})(?:\\s+#.*)?$`,
    ));
    assert.ok(entry, `Unsupported ${label} ${name} entry: ${line.trim()}`);
    entries.push(`${entry[1]}: ${entry[2]}`);
  }
  return entries;
}

function hasMappingDeclaration(scope, name, indentation) {
  const prefix = " ".repeat(indentation);
  return scope.split(/\r?\n/).some((line) => new RegExp(`^${prefix}${name}(?:\\s*:.*)$`).test(line));
}

export function validateReleaseWorkflowText(workflow) {
  assert.doesNotMatch(workflow, /^ *\t/m, "Release workflow indentation must not contain tabs.");
  assert.doesNotMatch(workflow, /^\s*pull_request_target:/m, "Release workflow must not use pull_request_target.");
  assert.doesNotMatch(workflow, /^\s*permissions:\s*(?:read-all|write-all)\s*$/m, "Release permissions must use an explicit mapping.");
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
  assert.deepEqual(
    mappingEntries(workflow, "permissions", 0, "Workflow defaults"),
    ["contents: read"],
    "Workflow defaults must grant only read-only contents permission.",
  );
  assert.deepEqual(
    mappingEntries(workflow, "env", 0, "Workflow", {
      keyPattern: "[A-Z][A-Z0-9_]*",
      valuePattern: '\\"[^\\"\\r\\n]*\\"',
    }),
    ['RELEASE_PUBLICATION_ENABLED: "false"'],
    "Release publication must remain explicitly disabled while the repository is unlicensed.",
  );
  assert.equal(
    (workflow.match(/^\s*RELEASE_PUBLICATION_ENABLED:/gm) ?? []).length,
    1,
    "Release publication approval must not be overridden at job or step scope.",
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
  assert.equal(hasMappingDeclaration(build, "permissions", 4), false, "Build job must not override the read-only workflow permissions.");
  assert.match(
    publish,
    /^    if: github\.event_name == 'push' && github\.ref_type == 'tag'$/m,
    "Publish job must run only for a tag push.",
  );
  assert.deepEqual(mappingEntries(publish, "permissions", 4, "Publish job").sort(), [
    "artifact-metadata: write",
    "attestations: write",
    "contents: write",
    "id-token: write",
  ], "Publish permissions changed unexpectedly.");

  const authorizationGate = publish.indexOf("name: Enforce release authorization gate");
  const attestation = publish.indexOf("uses: actions/attest@");
  const finalAttestation = publish.lastIndexOf("uses: actions/attest@");
  const verification = publish.indexOf("node scripts/verify-attestations.mjs");
  const publication = publish.indexOf("node scripts/publish-release.mjs");
  const ghInstallation = publish.indexOf("name: Install verified GitHub CLI");
  assert.ok(authorizationGate >= 0, "Publish job must enforce the release authorization gate.");
  assert.ok(
    publish.includes('[[ "${RELEASE_PUBLICATION_ENABLED}" == "true" ]]'),
    "Publish job must require explicit maintainer publication approval.",
  );
  for (const license of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    assert.ok(publish.includes(`-f ${license}`), `Publish authorization gate must check ${license}.`);
    assert.ok(publish.includes(`! -L ${license}`), `Publish authorization gate must reject a symlinked ${license}.`);
  }
  assert.ok(authorizationGate < ghInstallation, "Release authorization must be checked before release tooling is installed.");
  assert.ok(authorizationGate < attestation, "Release authorization must be checked before attestations mutate GitHub state.");
  assert.ok(authorizationGate < publication, "Release authorization must be checked before publication.");
  assert.ok(ghInstallation >= 0, "Publish job must install a checksummed GitHub CLI.");
  assert.ok(ghInstallation < verification, "The verified GitHub CLI must be installed before provenance verification.");
  assert.ok(publish.includes('GH_CLI_VERSION: "2.94.0"'), "GitHub CLI version changed unexpectedly.");
  assert.ok(
    publish.includes('GH_CLI_SHA256: "a757f1ba6db18f4de8cbadb244843a5f89bc75b5e7c6fc127d2bd77fbd12ed62"'),
    "GitHub CLI checksum changed unexpectedly.",
  );
  assert.ok(publish.includes("sha256sum --check --strict"), "GitHub CLI archive must be checksum-verified.");
  assert.ok(publish.includes('>> "${GITHUB_PATH}"'), "Verified GitHub CLI must be placed on the workflow path.");
  assert.equal(
    (publish.match(/uses: actions\/attest@/g) ?? []).length,
    2,
    "Publish job must attest both the checksum entries and the checksum manifest.",
  );
  assert.ok(publish.includes("subject-checksums: release/SHA256SUMS"), "Release assets must be attested from checksums.");
  assert.ok(publish.includes("subject-path: release/SHA256SUMS"), "SHA256SUMS must receive its own attestation.");
  assert.ok(attestation >= 0, "Publish job must create GitHub attestations.");
  assert.ok(verification > finalAttestation, "Attestations must be verified after creation.");
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
