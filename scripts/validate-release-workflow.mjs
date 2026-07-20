import assert from "node:assert/strict";

import { isAlias, isMap, isScalar, isSeq, parseAllDocuments } from "yaml";

const remoteUsePattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[0-9a-f]{40}$/;
const nonCanonicalYamlLineSeparatorPattern = /[\u0085\u2028\u2029]/u;
const loneCarriageReturnPattern = /\r(?!\n)/u;

const actions = Object.freeze({
  checkout: "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
  setupNode: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  uploadArtifact: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  downloadArtifact: "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
  attest: "actions/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6",
});

function block(...lines) {
  return `${lines.join("\n")}\n`;
}

const runs = Object.freeze({
  toolchain: block(
    "set -euo pipefail",
    '[[ "$(node --version)" == "v22.23.1" ]]',
    '[[ "$(npm --version)" == "10.9.8" ]]',
  ),
  install: "npm ci --ignore-scripts",
  metadata: block(
    "set -euo pipefail",
    "arguments=()",
    'if [[ "${GITHUB_REF_TYPE}" == "tag" ]]; then',
    '  source_commit="$(git rev-parse "${GITHUB_REF_NAME}^{commit}")"',
    '  [[ "${source_commit}" == "$(git rev-parse HEAD)" ]]',
    '  git fetch --no-tags origin "+refs/heads/${DEFAULT_BRANCH}:refs/remotes/origin/${DEFAULT_BRANCH}"',
    '  default_head="$(git rev-parse "refs/remotes/origin/${DEFAULT_BRANCH}^{commit}")"',
    '  git merge-base --is-ancestor "${source_commit}" "${default_head}"',
    '  arguments+=(--tag "${GITHUB_REF_NAME}")',
    'elif [[ -n "${EXPECTED_TAG}" ]]; then',
    '  arguments+=(--tag "${EXPECTED_TAG}")',
    "fi",
    'version="$(node scripts/validate-release.mjs "${arguments[@]}")"',
    'printf \'version=%s\\n\' "${version}" >> "${GITHUB_OUTPUT}"',
  ),
  testAndAudit: block(
    "npm run check",
    "npm audit --audit-level=moderate",
  ),
  package: block(
    "set -euo pipefail",
    "mkdir -p target/package-a target/package-b target/install",
    "npm pack --ignore-scripts --pack-destination target/package-a",
    "npm pack --ignore-scripts --pack-destination target/package-b",
    'archive="target/package-a/dig-gopher-explorer-${VERSION}.tgz"',
    'comparison_archive="target/package-b/dig-gopher-explorer-${VERSION}.tgz"',
    '[[ -f "${archive}" ]]',
    'cmp "${archive}" "${comparison_archive}"',
    'npm install --ignore-scripts --global --prefix target/install "./${archive}"',
    '[[ "$(target/install/bin/dig-gopher --version)" == "DIG ${VERSION}" ]]',
    'printf \'archive=%s\\n\' "${archive}" >> "${GITHUB_OUTPUT}"',
  ),
  sbom: block(
    "set -euo pipefail",
    "npm sbom --omit=dev --sbom-format cyclonedx > target/sbom-a.raw.json",
    "sleep 1",
    "npm sbom --omit=dev --sbom-format cyclonedx > target/sbom-b.raw.json",
    'node scripts/normalize-sbom.mjs target/sbom-a.raw.json "target/dig-${VERSION}.cdx.json"',
    "node scripts/normalize-sbom.mjs target/sbom-b.raw.json target/sbom-b.cdx.json",
    'cmp "target/dig-${VERSION}.cdx.json" target/sbom-b.cdx.json',
    'npm ls --omit=dev --all --json > "target/dig-npm-dependencies-${VERSION}.json"',
    "npm ls --omit=dev --all --json > target/dependencies-b.json",
    'cmp "target/dig-npm-dependencies-${VERSION}.json" target/dependencies-b.json',
  ),
  assemble: block(
    "set -euo pipefail",
    "node scripts/validate-release.mjs \\",
    "  --assemble release \\",
    '  --commit "$(git rev-parse HEAD)" \\',
    '  --archive "${ARCHIVE}" \\',
    '  --sbom "target/dig-${VERSION}.cdx.json" \\',
    '  --dependencies "target/dig-npm-dependencies-${VERSION}.json"',
  ),
  publicationGate: block(
    "set -euo pipefail",
    '[[ "${RELEASE_PUBLICATION_ENABLED}" == "true" ]] || {',
    '  echo "Release publication is disabled by the repository\'s static release policy." >&2',
    "  exit 1",
    "}",
  ),
  licenseGate: block(
    "set -euo pipefail",
    "[[ -f LICENSE && ! -L LICENSE ]] || {",
    '  echo "Release publication requires the canonical MIT LICENSE file." >&2',
    "  exit 1",
    "}",
  ),
  installGh: block(
    "set -euo pipefail",
    'archive="${RUNNER_TEMP}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz"',
    "curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \\",
    '  "https://github.com/cli/cli/releases/download/v${GH_CLI_VERSION}/gh_${GH_CLI_VERSION}_linux_amd64.tar.gz" \\',
    '  --output "${archive}"',
    'printf \'%s  %s\\n\' "${GH_CLI_SHA256}" "${archive}" | sha256sum --check --strict',
    'tar --extract --gzip --file "${archive}" --directory "${RUNNER_TEMP}"',
    'gh_directory="${RUNNER_TEMP}/gh_${GH_CLI_VERSION}_linux_amd64/bin"',
    '[[ "$("${gh_directory}/gh" --version | head -n 1)" == "gh version ${GH_CLI_VERSION} (2026-06-10)" ]]',
    'printf \'%s\\n\' "${gh_directory}" >> "${GITHUB_PATH}"',
  ),
  reverify: block(
    "set -euo pipefail",
    "npm ci --ignore-scripts",
    'source_commit="$(git rev-parse "${GITHUB_REF_NAME}^{commit}")"',
    '[[ "${source_commit}" == "$(git rev-parse HEAD)" ]]',
    'git fetch --no-tags origin "+refs/heads/${DEFAULT_BRANCH}:refs/remotes/origin/${DEFAULT_BRANCH}"',
    'default_head="$(git rev-parse "refs/remotes/origin/${DEFAULT_BRANCH}^{commit}")"',
    'git merge-base --is-ancestor "${source_commit}" "${default_head}"',
    'printf \'source_commit=%s\\n\' "${source_commit}" >> "${GITHUB_OUTPUT}"',
    "node scripts/validate-release.mjs \\",
    '  --tag "${GITHUB_REF_NAME}" \\',
    "  --verify-bundle release \\",
    '  --commit "${source_commit}"',
  ),
  verifyAttestations: 'node scripts/verify-attestations.mjs --directory release --repository "${{ github.repository }}" --signer-workflow "${{ github.repository }}/.github/workflows/release.yml" --source-commit "${{ steps.source.outputs.source_commit }}" --source-ref "${{ github.ref }}"',
  publish: 'node scripts/publish-release.mjs --directory release --tag "${{ github.ref_name }}" --repository "${{ github.repository }}" --default-branch "${{ github.event.repository.default_branch }}" --source-commit "${{ steps.source.outputs.source_commit }}"',
});

const buildContracts = Object.freeze([
  { name: "Check out repository", uses: actions.checkout, with: { "fetch-depth": 0, "persist-credentials": false } },
  { name: "Set up Node.js", uses: actions.setupNode, with: { "node-version": "22.23.1", cache: "npm" } },
  { name: "Verify pinned Node.js toolchain", shell: "bash", run: runs.toolchain },
  { name: "Install locked release tooling", run: runs.install },
  {
    name: "Validate synchronized release metadata and source",
    id: "metadata",
    shell: "bash",
    env: {
      DEFAULT_BRANCH: "${{ github.event.repository.default_branch }}",
      EXPECTED_TAG: "${{ inputs.expected_tag }}",
    },
    run: runs.metadata,
  },
  { name: "Test and audit all dependencies", run: runs.testAndAudit },
  {
    name: "Build and smoke-test installable CLI package",
    id: "package",
    shell: "bash",
    env: { VERSION: "${{ steps.metadata.outputs.version }}" },
    run: runs.package,
  },
  {
    name: "Capture SBOM and dependency evidence",
    shell: "bash",
    env: { VERSION: "${{ steps.metadata.outputs.version }}" },
    run: runs.sbom,
  },
  {
    name: "Assemble and reverify release bundle",
    shell: "bash",
    env: {
      VERSION: "${{ steps.metadata.outputs.version }}",
      ARCHIVE: "${{ steps.package.outputs.archive }}",
    },
    run: runs.assemble,
  },
  {
    name: "Upload verified release candidate",
    uses: actions.uploadArtifact,
    with: {
      name: "dig-release-candidate",
      path: "release",
      "if-no-files-found": "error",
      "retention-days": 7,
      "compression-level": 0,
    },
  },
]);

const publishContracts = Object.freeze([
  { name: "Enforce static publication approval", shell: "bash", run: runs.publicationGate },
  { name: "Check out tagged source", uses: actions.checkout, with: { "fetch-depth": 0, "persist-credentials": false } },
  { name: "Enforce checked-in license", shell: "bash", run: runs.licenseGate },
  { name: "Set up Node.js", uses: actions.setupNode, with: { "node-version": "22.23.1", cache: "npm" } },
  { name: "Verify pinned Node.js toolchain", shell: "bash", run: runs.toolchain },
  {
    name: "Install verified GitHub CLI",
    shell: "bash",
    env: {
      GH_CLI_VERSION: "2.94.0",
      GH_CLI_SHA256: "a757f1ba6db18f4de8cbadb244843a5f89bc75b5e7c6fc127d2bd77fbd12ed62",
    },
    run: runs.installGh,
  },
  {
    name: "Download verified release candidate",
    uses: actions.downloadArtifact,
    with: { name: "dig-release-candidate", path: "release" },
  },
  {
    name: "Reverify tag, default-branch source, inventory, and checksums",
    id: "source",
    shell: "bash",
    env: { DEFAULT_BRANCH: "${{ github.event.repository.default_branch }}" },
    run: runs.reverify,
  },
  { name: "Attest release assets", uses: actions.attest, with: { "subject-checksums": "release/SHA256SUMS" } },
  { name: "Attest checksum manifest", uses: actions.attest, with: { "subject-path": "release/SHA256SUMS" } },
  {
    name: "Verify release provenance before publication",
    env: { GH_TOKEN: "${{ github.token }}" },
    run: runs.verifyAttestations,
  },
  {
    name: "Stage, verify, and publish GitHub Release",
    env: { GH_TOKEN: "${{ github.token }}" },
    run: runs.publish,
  },
]);

function canonicalWorkflowText(workflow) {
  assert.equal(typeof workflow, "string", "Release workflow source must be text.");
  assert.equal(
    nonCanonicalYamlLineSeparatorPattern.test(workflow),
    false,
    "Release workflow contains a forbidden non-canonical YAML line separator.",
  );
  assert.equal(
    loneCarriageReturnPattern.test(workflow),
    false,
    "Release workflow contains a forbidden lone carriage return.",
  );
  return workflow.replaceAll("\r\n", "\n");
}

function parseWorkflow(workflow) {
  const documents = parseAllDocuments(canonicalWorkflowText(workflow), {
    schema: "core",
    strict: true,
    uniqueKeys: true,
    merge: false,
    prettyErrors: true,
  });
  assert.equal(documents.length, 1, "Release workflow must contain exactly one YAML document.");
  const [document] = documents;
  assert.deepEqual(
    document.errors.map(({ message }) => message),
    [],
    `Release workflow is invalid YAML: ${document.errors.map(({ message }) => message).join("; ")}`,
  );
  assert.deepEqual(
    document.warnings.map(({ message }) => message),
    [],
    `Release workflow contains unsupported YAML: ${document.warnings.map(({ message }) => message).join("; ")}`,
  );
  assert.ok(isMap(document.contents), "Release workflow root must be a YAML mapping.");
  return document.contents;
}

function scalarValue(node, label) {
  assert.ok(isScalar(node), `${label} must be a scalar.`);
  return node.value;
}

function mappingEntries(node, label) {
  assert.ok(isMap(node), `${label} must be a mapping.`);
  const entries = new Map();
  for (const pair of node.items) {
    assert.ok(isScalar(pair.key) && typeof pair.key.value === "string", `${label} keys must be plain scalar names.`);
    assert.equal(entries.has(pair.key.value), false, `${label} repeats ${pair.key.value}.`);
    entries.set(pair.key.value, pair.value);
  }
  return entries;
}

function exactKeys(entries, expected, label) {
  assert.deepEqual(
    [...entries.keys()].sort(),
    [...expected].sort(),
    `${label} has missing, extra, or shadow keys.`,
  );
}

function exactScalar(node, expected, label) {
  assert.equal(scalarValue(node, label), expected, `${label} changed unexpectedly.`);
}

function exactMapping(node, expected, label) {
  const entries = mappingEntries(node, label);
  exactKeys(entries, Object.keys(expected), label);
  for (const [key, value] of Object.entries(expected)) exactScalar(entries.get(key), value, `${label}.${key}`);
}

function stringSequence(node, label) {
  assert.ok(isSeq(node), `${label} must be a sequence.`);
  return node.items.map((item, index) => {
    const value = scalarValue(item, `${label}[${index}]`);
    assert.equal(typeof value, "string", `${label}[${index}] must be a string.`);
    return value;
  });
}

function walkYaml(node, path, state) {
  if (node === null || node === undefined) return;
  assert.equal(isAlias(node), false, `Release workflow does not allow YAML aliases at ${path}.`);
  assert.equal(node.anchor, undefined, `Release workflow does not allow YAML anchors at ${path}.`);
  assert.equal(node.tag, undefined, `Release workflow does not allow explicit YAML tags at ${path}.`);
  if (isMap(node)) {
    for (const pair of node.items) {
      walkYaml(pair.key, `${path}.<key>`, state);
      assert.ok(isScalar(pair.key) && typeof pair.key.value === "string", `Release workflow has a complex key at ${path}.`);
      const key = pair.key.value;
      const childPath = `${path}.${key}`;
      if (key === "uses") state.uses.push({ node: pair.value, path: childPath });
      if (key === "permissions") state.permissions.push(childPath);
      if (key === "RELEASE_PUBLICATION_ENABLED") state.publicationFlags.push(childPath);
      walkYaml(pair.value, childPath, state);
    }
    return;
  }
  if (isSeq(node)) node.items.forEach((item, index) => walkYaml(item, `${path}[${index}]`, state));
}

function validateUses(uses) {
  const expected = [...buildContracts, ...publishContracts]
    .filter(({ uses: reference }) => reference)
    .map(({ uses: reference }) => reference);
  const actual = uses.map(({ node, path }) => {
    const reference = scalarValue(node, path);
    assert.equal(typeof reference, "string", `${path} must be a string.`);
    assert.equal(
      reference.startsWith("./") || reference.startsWith("../") || reference.startsWith("/"),
      false,
      `${path} local actions are forbidden by the release contract: ${reference}`,
    );
    assert.match(
      reference,
      remoteUsePattern,
      `${path} must be owner/repository[/path] pinned to a lowercase 40-character commit SHA: ${reference}`,
    );
    const location = reference.slice(0, reference.lastIndexOf("@"));
    assert.ok(
      location.split("/").every((segment) => segment !== "." && segment !== ".."),
      `${path} contains an unsafe remote action path: ${reference}`,
    );
    return reference;
  });
  assert.deepEqual(actual, expected, "Release workflow action owner, repository, SHA, or order changed unexpectedly.");
}

function validateTriggers(root) {
  const triggers = mappingEntries(root.get("on"), "Workflow triggers");
  exactKeys(triggers, ["pull_request", "push", "workflow_dispatch"], "Workflow triggers");
  assert.equal(
    scalarValue(triggers.get("pull_request"), "pull_request trigger"),
    null,
    "pull_request must remain unfiltered so the required build context always runs.",
  );
  const dispatch = mappingEntries(triggers.get("workflow_dispatch"), "workflow_dispatch");
  exactKeys(dispatch, ["inputs"], "workflow_dispatch");
  const inputs = mappingEntries(dispatch.get("inputs"), "workflow_dispatch inputs");
  exactKeys(inputs, ["expected_tag"], "workflow_dispatch inputs");
  exactMapping(inputs.get("expected_tag"), {
    description: "Optional v<version> value to exercise tag validation without publishing",
    required: false,
    type: "string",
  }, "expected_tag input");
  const push = mappingEntries(triggers.get("push"), "push trigger");
  exactKeys(push, ["branches", "tags"], "push trigger");
  assert.deepEqual(stringSequence(push.get("branches"), "push branches"), ["main"], "Release workflow must build main pushes only.");
  assert.deepEqual(stringSequence(push.get("tags"), "push tags"), ["v*"], "Release workflow must build stable-tag candidates only.");
}

function validateStepSequence(node, contracts, label) {
  assert.ok(isSeq(node), `${label} must be a sequence.`);
  assert.equal(node.items.length, contracts.length, `${label} changed unexpectedly.`);
  const names = new Set();
  for (const [index, contract] of contracts.entries()) {
    const stepLabel = `${label}[${index}] ${contract.name}`;
    const step = mappingEntries(node.items[index], stepLabel);
    const expectedKeys = ["name", contract.uses ? "uses" : "run"];
    for (const optional of ["id", "shell", "env", "with"]) {
      if (Object.hasOwn(contract, optional)) expectedKeys.push(optional);
    }
    exactKeys(step, expectedKeys, stepLabel);
    exactScalar(step.get("name"), contract.name, `${stepLabel}.name`);
    assert.equal(names.has(contract.name), false, `${label} repeats ${contract.name}.`);
    names.add(contract.name);
    if (contract.uses) exactScalar(step.get("uses"), contract.uses, `${stepLabel}.uses`);
    else exactScalar(step.get("run"), contract.run, `${stepLabel}.run`);
    if (contract.id) exactScalar(step.get("id"), contract.id, `${stepLabel}.id`);
    if (contract.shell) exactScalar(step.get("shell"), contract.shell, `${stepLabel}.shell`);
    if (contract.env) exactMapping(step.get("env"), contract.env, `${stepLabel}.env`);
    if (contract.with) exactMapping(step.get("with"), contract.with, `${stepLabel}.with`);
  }
}

export function validateReleaseWorkflowText(workflow) {
  const rootNode = parseWorkflow(workflow);
  const state = { uses: [], permissions: [], publicationFlags: [] };
  walkYaml(rootNode, "$", state);
  validateUses(state.uses);

  const root = mappingEntries(rootNode, "Release workflow");
  exactKeys(root, ["concurrency", "env", "jobs", "name", "on", "permissions"], "Release workflow");
  exactScalar(root.get("name"), "Release readiness", "Workflow name");
  validateTriggers(root);
  exactMapping(root.get("permissions"), { contents: "read" }, "Workflow permissions");
  exactMapping(root.get("env"), { RELEASE_PUBLICATION_ENABLED: "true" }, "Workflow environment");
  assert.deepEqual(state.publicationFlags, ["$.env.RELEASE_PUBLICATION_ENABLED"], "Release publication approval must not be shadowed or overridden.");
  assert.deepEqual(
    state.permissions.sort(),
    ["$.jobs.publish.permissions", "$.permissions"],
    "Only root and publish-job permissions are supported.",
  );
  exactMapping(root.get("concurrency"), {
    group: "release-${{ github.ref }}",
    "cancel-in-progress": false,
  }, "Workflow concurrency");

  const jobs = mappingEntries(root.get("jobs"), "Release jobs");
  exactKeys(jobs, ["build", "publish"], "Release jobs");
  const build = mappingEntries(jobs.get("build"), "Build job");
  exactKeys(build, ["name", "runs-on", "steps", "timeout-minutes"], "Build job");
  exactScalar(build.get("name"), "Build and verify release candidate", "Build job name");
  exactScalar(build.get("runs-on"), "ubuntu-24.04", "Build runner");
  exactScalar(build.get("timeout-minutes"), 15, "Build timeout");

  const publish = mappingEntries(jobs.get("publish"), "Publish job");
  exactKeys(publish, ["if", "name", "needs", "permissions", "runs-on", "steps", "timeout-minutes"], "Publish job");
  exactScalar(publish.get("name"), "Attest and publish tagged release", "Publish job name");
  exactScalar(publish.get("if"), "github.event_name == 'push' && github.ref_type == 'tag'", "Publish condition");
  exactScalar(publish.get("needs"), "build", "Publish dependency");
  exactScalar(publish.get("runs-on"), "ubuntu-24.04", "Publish runner");
  exactScalar(publish.get("timeout-minutes"), 10, "Publish timeout");
  exactMapping(publish.get("permissions"), {
    contents: "write",
    "id-token": "write",
    attestations: "write",
    "artifact-metadata": "write",
  }, "Publish permissions");

  validateStepSequence(build.get("steps"), buildContracts, "Build steps");
  validateStepSequence(publish.get("steps"), publishContracts, "Publish steps");
}
