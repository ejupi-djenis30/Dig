import assert from "node:assert/strict";

import { isAlias, isMap, isScalar, isSeq, parseAllDocuments } from "yaml";

const remoteUsePattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[0-9a-f]{40}$/;
const localUsePattern = /^\.\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_.\/-]+$/;

function parseWorkflow(workflow) {
  const documents = parseAllDocuments(workflow, {
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

function exactString(node, expected, label) {
  assert.equal(scalarValue(node, label), expected, `${label} changed unexpectedly.`);
}

function exactBoolean(node, expected, label) {
  assert.equal(scalarValue(node, label), expected, `${label} changed unexpectedly.`);
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
  if (isSeq(node)) {
    node.items.forEach((item, index) => walkYaml(item, `${path}[${index}]`, state));
  }
}

function validateUses(uses, allowedLocalActions) {
  assert.ok(uses.length > 0, "Release workflow contains no actions.");
  for (const { node, path } of uses) {
    const reference = scalarValue(node, path);
    assert.equal(typeof reference, "string", `${path} must be a string.`);
    if (reference.startsWith("./")) {
      assert.match(reference, localUsePattern, `${path} contains an unsafe local action path.`);
      assert.ok(allowedLocalActions.has(reference), `${path} references an unapproved local action: ${reference}`);
    } else {
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
    }
  }
}

function validateTriggers(root) {
  const triggers = mappingEntries(root.get("on"), "Workflow triggers");
  exactKeys(triggers, ["pull_request", "push", "workflow_dispatch"], "Workflow triggers");
  assert.equal(
    scalarValue(triggers.get("pull_request"), "pull_request trigger"),
    null,
    "pull_request must not accept privileged or dynamic configuration.",
  );

  const dispatch = mappingEntries(triggers.get("workflow_dispatch"), "workflow_dispatch");
  exactKeys(dispatch, ["inputs"], "workflow_dispatch");
  const inputs = mappingEntries(dispatch.get("inputs"), "workflow_dispatch inputs");
  exactKeys(inputs, ["expected_tag"], "workflow_dispatch inputs");
  const expectedTag = mappingEntries(inputs.get("expected_tag"), "expected_tag input");
  exactKeys(expectedTag, ["description", "required", "type"], "expected_tag input");
  assert.equal(typeof scalarValue(expectedTag.get("description"), "expected_tag description"), "string");
  exactBoolean(expectedTag.get("required"), false, "expected_tag required");
  exactString(expectedTag.get("type"), "string", "expected_tag type");

  const push = mappingEntries(triggers.get("push"), "push trigger");
  exactKeys(push, ["branches", "tags"], "push trigger");
  assert.deepEqual(stringSequence(push.get("branches"), "push branches"), ["main"], "Release workflow must build main pushes only.");
  assert.deepEqual(stringSequence(push.get("tags"), "push tags"), ["v*"], "Release workflow must build stable-tag candidates only.");
}

function validatePermissions(node, expected, label) {
  const permissions = mappingEntries(node, label);
  exactKeys(permissions, Object.keys(expected), label);
  for (const [name, level] of Object.entries(expected)) exactString(permissions.get(name), level, `${label}.${name}`);
}

function validateStepSequence(node, label) {
  assert.ok(isSeq(node) && node.items.length > 0, `${label} must contain steps.`);
  const steps = [];
  const names = new Set();
  for (const [index, item] of node.items.entries()) {
    const step = mappingEntries(item, `${label}[${index}]`);
    const allowed = [
      "continue-on-error",
      "env",
      "id",
      "if",
      "name",
      "run",
      "shell",
      "timeout-minutes",
      "uses",
      "with",
      "working-directory",
    ];
    assert.ok([...step.keys()].every((key) => allowed.includes(key)), `${label}[${index}] contains an unsupported step key.`);
    const name = scalarValue(step.get("name"), `${label}[${index}].name`);
    assert.equal(typeof name, "string", `${label}[${index}].name must be a string.`);
    assert.equal(names.has(name), false, `${label} repeats step name ${name}.`);
    names.add(name);
    assert.notEqual(step.has("uses"), step.has("run"), `${label}[${index}] must declare exactly one of uses or run.`);
    if (step.has("uses")) assert.equal(typeof scalarValue(step.get("uses"), `${label}[${index}].uses`), "string");
    if (step.has("run")) assert.equal(typeof scalarValue(step.get("run"), `${label}[${index}].run`), "string");
    if (step.has("env")) mappingEntries(step.get("env"), `${label}[${index}].env`);
    if (step.has("with")) mappingEntries(step.get("with"), `${label}[${index}].with`);
    steps.push({ name, entries: step });
  }
  return steps;
}

function stepByName(steps, name, label) {
  const matches = steps.filter((step) => step.name === name);
  assert.equal(matches.length, 1, `${label} must contain exactly one ${name} step.`);
  return matches[0];
}

function stepIndex(steps, name, label) {
  const index = steps.findIndex((step) => step.name === name);
  assert.notEqual(index, -1, `${label} is missing ${name}.`);
  return index;
}

function stepRun(step, label) {
  const value = scalarValue(step.entries.get("run"), `${label}.run`);
  assert.equal(typeof value, "string", `${label}.run must be a string.`);
  return value;
}

function validateNodeSetup(steps, label) {
  const setup = steps.filter(({ entries }) => entries.has("uses")
    && scalarValue(entries.get("uses"), `${label}.uses`) === "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
  assert.equal(setup.length, 1, `${label} must use the pinned Node.js setup action exactly once.`);
  const withEntries = mappingEntries(setup[0].entries.get("with"), `${label} setup-node.with`);
  exactKeys(withEntries, ["cache", "node-version"], `${label} setup-node.with`);
  exactString(withEntries.get("node-version"), "22.23.1", `${label} Node.js version`);
  exactString(withEntries.get("cache"), "npm", `${label} dependency cache`);
}

function validateSourceContainment(steps, stepName, label) {
  const run = stepRun(stepByName(steps, stepName, label), `${label}.${stepName}`);
  assert.ok(run.includes('source_commit="$(git rev-parse "${GITHUB_REF_NAME}^{commit}")"'), `${label} must resolve the remote tag commit explicitly.`);
  assert.ok(run.includes('[[ "${source_commit}" == "$(git rev-parse HEAD)" ]]'), `${label} must bind the checkout to the tag commit.`);
  assert.ok(run.includes('git fetch --no-tags origin "+refs/heads/${DEFAULT_BRANCH}:refs/remotes/origin/${DEFAULT_BRANCH}"'), `${label} must refresh the current default branch.`);
  assert.ok(run.includes('git merge-base --is-ancestor "${source_commit}" "${default_head}"'), `${label} must require tagged-source containment in the default branch.`);
  assert.equal(run.includes('[[ "${source_commit}" == "${default_head}" ]]'), false, `${label} must allow safe recovery after the default branch advances.`);
}

export function validateReleaseWorkflowText(workflow, { allowedLocalActions = [] } = {}) {
  const rootNode = parseWorkflow(workflow);
  const state = { uses: [], permissions: [], publicationFlags: [] };
  walkYaml(rootNode, "$", state);
  validateUses(state.uses, new Set(allowedLocalActions));

  const root = mappingEntries(rootNode, "Release workflow");
  exactKeys(root, ["concurrency", "env", "jobs", "name", "on", "permissions"], "Release workflow");
  exactString(root.get("name"), "Release readiness", "Workflow name");
  validateTriggers(root);
  validatePermissions(root.get("permissions"), { contents: "read" }, "Workflow permissions");

  const environment = mappingEntries(root.get("env"), "Workflow environment");
  exactKeys(environment, ["RELEASE_PUBLICATION_ENABLED"], "Workflow environment");
  exactString(environment.get("RELEASE_PUBLICATION_ENABLED"), "false", "Release publication approval");
  assert.deepEqual(state.publicationFlags, ["$.env.RELEASE_PUBLICATION_ENABLED"], "Release publication approval must not be shadowed or overridden.");
  assert.deepEqual(
    state.permissions.sort(),
    ["$.jobs.publish.permissions", "$.permissions"],
    "Only root and publish-job permissions are supported.",
  );

  const concurrency = mappingEntries(root.get("concurrency"), "Workflow concurrency");
  exactKeys(concurrency, ["cancel-in-progress", "group"], "Workflow concurrency");
  exactString(concurrency.get("group"), "release-${{ github.ref }}", "Workflow concurrency group");
  exactBoolean(concurrency.get("cancel-in-progress"), false, "Workflow concurrency cancellation");

  const jobs = mappingEntries(root.get("jobs"), "Release jobs");
  exactKeys(jobs, ["build", "publish"], "Release jobs");
  const build = mappingEntries(jobs.get("build"), "Build job");
  exactKeys(build, ["name", "runs-on", "steps", "timeout-minutes"], "Build job");
  exactString(build.get("name"), "Build and verify release candidate", "Build job name");
  exactString(build.get("runs-on"), "ubuntu-24.04", "Build runner");
  assert.equal(scalarValue(build.get("timeout-minutes"), "Build timeout"), 15, "Build timeout changed unexpectedly.");

  const publish = mappingEntries(jobs.get("publish"), "Publish job");
  exactKeys(publish, ["if", "name", "needs", "permissions", "runs-on", "steps", "timeout-minutes"], "Publish job");
  exactString(publish.get("name"), "Attest and publish tagged release", "Publish job name");
  exactString(publish.get("if"), "github.event_name == 'push' && github.ref_type == 'tag'", "Publish condition");
  exactString(publish.get("needs"), "build", "Publish dependency");
  exactString(publish.get("runs-on"), "ubuntu-24.04", "Publish runner");
  assert.equal(scalarValue(publish.get("timeout-minutes"), "Publish timeout"), 10, "Publish timeout changed unexpectedly.");
  validatePermissions(publish.get("permissions"), {
    "artifact-metadata": "write",
    attestations: "write",
    contents: "write",
    "id-token": "write",
  }, "Publish permissions");

  const buildSteps = validateStepSequence(build.get("steps"), "Build steps");
  const publishSteps = validateStepSequence(publish.get("steps"), "Publish steps");
  assert.deepEqual(buildSteps.map(({ name }) => name), [
    "Check out repository",
    "Set up Node.js",
    "Verify pinned Node.js toolchain",
    "Install locked release tooling",
    "Validate synchronized release metadata and source",
    "Test and audit all dependencies",
    "Build and smoke-test installable CLI package",
    "Capture SBOM and dependency evidence",
    "Assemble and reverify release bundle",
    "Upload verified release candidate",
  ], "Build steps changed unexpectedly.");
  assert.deepEqual(publishSteps.map(({ name }) => name), [
    "Check out tagged source",
    "Set up Node.js",
    "Enforce release authorization gate",
    "Verify pinned Node.js toolchain",
    "Install verified GitHub CLI",
    "Download verified release candidate",
    "Reverify tag, default-branch source, inventory, and checksums",
    "Attest release assets",
    "Attest checksum manifest",
    "Verify release provenance before publication",
    "Stage, verify, and publish GitHub Release",
  ], "Publish steps changed unexpectedly.");
  validateNodeSetup(buildSteps, "Build job");
  validateNodeSetup(publishSteps, "Publish job");
  const buildInstall = stepIndex(buildSteps, "Install locked release tooling", "Build job");
  const buildMetadata = stepIndex(buildSteps, "Validate synchronized release metadata and source", "Build job");
  assert.ok(buildInstall < buildMetadata, "Locked release tooling must be installed before metadata validation.");
  exactString(
    stepByName(buildSteps, "Install locked release tooling", "Build job").entries.get("run"),
    "npm ci --ignore-scripts",
    "Locked release tooling installation",
  );
  const testRun = stepRun(stepByName(buildSteps, "Test and audit all dependencies", "Build job"), "Build test and audit");
  assert.ok(testRun.includes("npm run check"), "Build job must run the complete project checks.");
  assert.ok(testRun.includes("npm audit --audit-level=moderate"), "Build job must audit all dependencies at moderate severity.");
  assert.equal(testRun.includes("--omit=dev"), false, "Build job must not omit release parser tooling from its audit.");
  validateSourceContainment(buildSteps, "Validate synchronized release metadata and source", "Build job");
  validateSourceContainment(publishSteps, "Reverify tag, default-branch source, inventory, and checksums", "Publish job");

  const authorization = stepIndex(publishSteps, "Enforce release authorization gate", "Publish job");
  const ghInstallation = stepIndex(publishSteps, "Install verified GitHub CLI", "Publish job");
  const firstAttestation = stepIndex(publishSteps, "Attest release assets", "Publish job");
  const secondAttestation = stepIndex(publishSteps, "Attest checksum manifest", "Publish job");
  const verification = stepIndex(publishSteps, "Verify release provenance before publication", "Publish job");
  const publication = stepIndex(publishSteps, "Stage, verify, and publish GitHub Release", "Publish job");
  assert.ok(authorization < ghInstallation, "Release authorization must precede release tooling installation.");
  assert.ok(ghInstallation < firstAttestation, "Verified GitHub CLI installation must precede attestations.");
  assert.ok(firstAttestation < secondAttestation && secondAttestation < verification, "Both attestations must precede provenance verification.");
  assert.ok(verification < publication, "Release publication must happen after provenance verification.");

  const authorizationRun = stepRun(publishSteps[authorization], "Release authorization gate");
  assert.ok(authorizationRun.includes('[[ "${RELEASE_PUBLICATION_ENABLED}" == "true" ]]'), "Publication requires explicit contributor approval.");
  for (const license of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    assert.ok(authorizationRun.includes(`-f ${license}`), `Authorization gate must check ${license}.`);
    assert.ok(authorizationRun.includes(`! -L ${license}`), `Authorization gate must reject a symlinked ${license}.`);
  }

  const installStep = stepByName(publishSteps, "Install verified GitHub CLI", "Publish job");
  const installEnvironment = mappingEntries(installStep.entries.get("env"), "GitHub CLI install environment");
  exactKeys(installEnvironment, ["GH_CLI_SHA256", "GH_CLI_VERSION"], "GitHub CLI install environment");
  exactString(installEnvironment.get("GH_CLI_VERSION"), "2.94.0", "GitHub CLI version");
  exactString(
    installEnvironment.get("GH_CLI_SHA256"),
    "a757f1ba6db18f4de8cbadb244843a5f89bc75b5e7c6fc127d2bd77fbd12ed62",
    "GitHub CLI checksum",
  );
  const installRun = stepRun(installStep, "GitHub CLI installation");
  assert.ok(installRun.includes("sha256sum --check --strict"), "GitHub CLI archive must be checksum-verified.");
  assert.ok(installRun.includes('>> "${GITHUB_PATH}"'), "Verified GitHub CLI must be placed on the workflow path.");

  const attestationUses = state.uses.filter(({ node }) => scalarValue(node, "uses")
    === "actions/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6");
  assert.equal(attestationUses.length, 2, "Publish job must create exactly two pinned attestations.");
  const attestationWith = mappingEntries(publishSteps[firstAttestation].entries.get("with"), "Asset attestation inputs");
  exactString(attestationWith.get("subject-checksums"), "release/SHA256SUMS", "Asset attestation checksum manifest");
  const manifestWith = mappingEntries(publishSteps[secondAttestation].entries.get("with"), "Manifest attestation inputs");
  exactString(manifestWith.get("subject-path"), "release/SHA256SUMS", "Manifest attestation subject");

  const verificationRun = stepRun(publishSteps[verification], "Provenance verification");
  const publicationRun = stepRun(publishSteps[publication], "Release publication");
  assert.ok(
    verificationRun.includes("node scripts/verify-attestations.mjs"),
    "Provenance verification must execute the reviewed verifier.",
  );
  assert.ok(
    publicationRun.includes("node scripts/publish-release.mjs"),
    "Release publication must execute the reviewed publisher.",
  );
  for (const required of [
    '--source-commit "${{ steps.source.outputs.source_commit }}"',
    '--source-ref "${{ github.ref }}"',
    '--signer-workflow "${{ github.repository }}/.github/workflows/release.yml"',
  ]) assert.ok(verificationRun.includes(required), `Provenance verification is missing binding: ${required}`);
  for (const required of [
    '--default-branch "${{ github.event.repository.default_branch }}"',
    '--source-commit "${{ steps.source.outputs.source_commit }}"',
  ]) assert.ok(publicationRun.includes(required), `Release publication is missing binding: ${required}`);
}
