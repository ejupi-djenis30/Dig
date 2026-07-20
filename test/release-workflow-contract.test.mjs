import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { validateReleaseWorkflowText } from "../scripts/validate-release-workflow.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const workflow = await readFile(resolve(repositoryRoot, ".github/workflows/release.yml"), "utf8");
const checkout = "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0";

function replaceOnce(source, search, replacement) {
  assert.ok(source.includes(search), `Fixture source is missing: ${search}`);
  return source.replace(search, replacement);
}

function replaceLast(source, search, replacement) {
  const index = source.lastIndexOf(search);
  assert.notEqual(index, -1, `Fixture source is missing: ${search}`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

function rejects(source, pattern) {
  assert.throws(() => validateReleaseWorkflowText(source), pattern);
}

test("release workflow YAML AST rejects duplicate, shadow, alias, tag, and unsupported job forms", () => {
  validateReleaseWorkflowText(workflow);
  rejects(
    replaceOnce(workflow, "name: Release readiness", "name: Release readiness\nname: Shadow"),
    /invalid YAML|Map keys must be unique/,
  );
  rejects(
    replaceOnce(workflow, "  build:\n", "  build:\n    name: Shadow\n  build:\n"),
    /invalid YAML|Map keys must be unique/,
  );
  rejects(`${workflow}\n  shadow-job:\n    runs-on: ubuntu-24.04\n    steps: []\n`, /missing, extra, or shadow keys/);
  rejects(
    replaceOnce(workflow, "  build:\n", "  \"bu\\u0069ld\":\n    name: Shadow\n  build:\n"),
    /invalid YAML|Map keys must be unique/,
  );
  rejects(
    replaceOnce(workflow, "permissions:\n  contents: read", "permissions: &root_permissions\n  contents: read"),
    /does not allow YAML anchors/,
  );
  rejects(
    replaceOnce(
      workflow,
      "    permissions:\n      contents: write\n      id-token: write\n      attestations: write\n      artifact-metadata: write",
      "    permissions: *root_permissions",
    ).replace("permissions:\n  contents: read", "permissions: &root_permissions\n  contents: read"),
    /does not allow YAML anchors|does not allow YAML aliases/,
  );
  rejects(replaceOnce(workflow, "name: Release readiness", "name: !!str Release readiness"), /explicit YAML tags/);
  rejects(`${workflow}\n---\nname: second document\n`, /exactly one YAML document/);
});

test("release workflow triggers and permissions are semantic exact mappings", () => {
  rejects(replaceOnce(workflow, "  pull_request:\n", "  pull_request_target:\n"), /missing, extra, or shadow keys/);
  rejects(replaceOnce(workflow, "on:\n  pull_request:", "on: [pull_request, push]"), /invalid YAML|must be a mapping/);
  rejects(
    replaceOnce(workflow, "  workflow_dispatch:\n", "  schedule:\n    - cron: '0 0 * * *'\n  workflow_dispatch:\n"),
    /missing, extra, or shadow keys/,
  );
  rejects(replaceOnce(workflow, "    branches:\n      - main", "    branches: [develop]"), /main pushes only/);
  rejects(replaceOnce(workflow, "    tags:\n      - \"v*\"", "    tags: ['*']"), /stable-tag candidates only/);
  rejects(replaceOnce(workflow, "permissions:\n  contents: read", "permissions: read-all"), /must be a mapping/);
  rejects(
    replaceOnce(workflow, "    permissions:\n      contents: write", "    permissions: write-all\n    env:\n      contents: write"),
    /must be a mapping|missing, extra, or shadow keys/,
  );
  rejects(
    replaceOnce(workflow, "      artifact-metadata: write", "      artifact-metadata: write\n      packages: write"),
    /missing, extra, or shadow keys/,
  );
  rejects(replaceOnce(workflow, "      contents: write", "      # contents: write"), /missing, extra, or shadow keys/);
  rejects(
    replaceOnce(workflow, "    name: Build and verify release candidate", "    permissions:\n      contents: read\n    name: Build and verify release candidate"),
    /Build job has missing, extra, or shadow keys|Only root and publish-job permissions/,
  );
  rejects(
    replaceOnce(workflow, "    permissions:\n      contents: write", "    permissions:\n      contents: write\n    permissions:\n      contents: write"),
    /invalid YAML|Map keys must be unique/,
  );
  rejects(
    replaceOnce(workflow, "    timeout-minutes: 10", '    timeout-minutes: 10\n    env:\n      RELEASE_PUBLICATION_ENABLED: "true"'),
    /shadowed or overridden|missing, extra, or shadow keys/,
  );
});

test("every uses node is AST-discovered and pinned across scalar and mapping forms", () => {
  for (const mutated of [
    replaceOnce(workflow, checkout, "actions/checkout@main"),
    replaceOnce(workflow, checkout, `actions/checkout@${"A".repeat(40)}`),
    replaceOnce(workflow, `uses: ${checkout}`, `\"uses\": \"actions/checkout@main\"`),
    replaceOnce(workflow, `uses: ${checkout}`, `\"u\\u0073es\": \"actions/checkout@main\"`),
    replaceOnce(workflow, `uses: ${checkout}`, "uses: >-\n          actions/checkout@main"),
    replaceOnce(
      workflow,
      `      - name: Check out repository\n        uses: ${checkout} # v7.0.0\n        with:\n          fetch-depth: 0\n          persist-credentials: false`,
      '      - { name: Flow use, "u\\u0073es": "attacker/action@main" }',
    ),
    `${workflow}\n  reusable-shadow:\n    uses: attacker/repository/.github/workflows/release.yml@main\n`,
    replaceOnce(workflow, checkout, "docker://alpine:latest"),
    replaceOnce(workflow, checkout, `owner/repository/../action@${"a".repeat(40)}`),
  ]) rejects(mutated, /lowercase 40-character commit SHA|unsafe remote action path|missing, extra, or shadow keys/);

  const local = replaceOnce(workflow, checkout, "./.github/actions/trusted");
  rejects(local, /unapproved local action/);
  validateReleaseWorkflowText(local, { allowedLocalActions: ["./.github/actions/trusted"] });
  rejects(
    replaceOnce(workflow, checkout, "./.github/actions/../untrusted"),
    /unsafe local action path|unapproved local action/,
  );
});

test("release workflow binds tag ancestry, toolchains, authorization, and publication order", () => {
  rejects(replaceOnce(workflow, "runs-on: ubuntu-24.04", "runs-on: ubuntu-latest"), /Build runner changed unexpectedly/);
  rejects(replaceOnce(workflow, 'node-version: "22.23.1"', 'node-version: "22"'), /Node\.js version changed unexpectedly/);
  rejects(
    replaceOnce(workflow, "npm audit --audit-level=moderate", "npm audit --omit=dev --audit-level=moderate"),
    /audit all dependencies|must not omit release parser tooling/,
  );
  rejects(
    replaceOnce(
      workflow,
      'git merge-base --is-ancestor "${source_commit}" "${default_head}"',
      '[[ "${source_commit}" == "${default_head}" ]]',
    ),
    /must require tagged-source containment|allow safe recovery/,
  );
  rejects(
    replaceLast(
      workflow,
      'git merge-base --is-ancestor "${source_commit}" "${default_head}"',
      '[[ "${source_commit}" == "${default_head}" ]]',
    ),
    /must require tagged-source containment|allow safe recovery/,
  );
  rejects(
    replaceOnce(workflow, '[[ "${source_commit}" == "$(git rev-parse HEAD)" ]]', "true"),
    /bind the checkout to the tag commit/,
  );
  rejects(replaceOnce(workflow, 'RELEASE_PUBLICATION_ENABLED: "false"', 'RELEASE_PUBLICATION_ENABLED: "true"'), /changed unexpectedly/);
  rejects(replaceOnce(workflow, "name: Enforce release authorization gate", "name: Authorization removed"), /authorization gate/);
  rejects(replaceOnce(workflow, "-f LICENSE.txt", "-e LICENSE.txt"), /must check LICENSE\.txt/);
  rejects(replaceOnce(workflow, "! -L LICENSE.txt", "! -d LICENSE.txt"), /reject a symlinked LICENSE\.txt/);
  rejects(replaceOnce(workflow, "sha256sum --check --strict", "sha256sum --check"), /checksum-verified/);
  rejects(
    replaceOnce(workflow, "subject-path: release/SHA256SUMS", "subject-path: release/release-metadata.json"),
    /Manifest attestation subject changed unexpectedly/,
  );
  const moved = workflow
    .replace("node scripts/verify-attestations.mjs", "node scripts/__swap.mjs")
    .replace("node scripts/publish-release.mjs", "node scripts/verify-attestations.mjs")
    .replace("node scripts/__swap.mjs", "node scripts/publish-release.mjs");
  rejects(moved, /missing binding|publication|reviewed verifier/i);
});
