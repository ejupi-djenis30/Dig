import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateReleaseWorkflowText } from "../scripts/validate-release-workflow.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const workflow = await readFile(resolve(repositoryRoot, ".github/workflows/release.yml"), "utf8");

test("release workflow keeps actions pinned and publication tag-only", () => {
  validateReleaseWorkflowText(workflow);
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace(/actions\/checkout@[0-9a-f]{40}/, "actions/checkout@main")),
    /full commit SHA/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace("github.event_name == 'push' && ", "")),
    /tag push/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace("permissions:\n  contents: read", "permissions:\n  contents: read\n  id-token: write")),
    /only read-only contents permission/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace("permissions:\n  contents: read", "permissions:\n  contents: read\n\n  id-token: write")),
    /only read-only contents permission/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace("runs-on: ubuntu-24.04", "runs-on: ubuntu-latest")),
    /pinned Ubuntu runner/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace('node-version: "22.23.1"', 'node-version: "22"')),
    /exact supported Node\.js runtime/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace(
      "    permissions:\n      contents: write\n      id-token: write\n      attestations: write\n      artifact-metadata: write",
      "    permissions: write-all\n    env:\n      contents: write\n      id-token: write\n      attestations: write\n      artifact-metadata: write",
    )),
    /explicit mapping/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace(
      "      artifact-metadata: write",
      "      artifact-metadata: write\n      packages: write",
    )),
    /Publish permissions changed unexpectedly/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace("      contents: write", "      # contents: write")),
    /Publish permissions changed unexpectedly/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace(
      "    permissions:\n      contents: write",
      "    permissions:\n      contents: write\n    permissions:\n      contents: write",
    )),
    /exactly one permissions mapping/,
  );
});

test("release workflow keeps OIDC scoped and provenance ahead of publication", () => {
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace(
      "    name: Build and verify release candidate",
      "    permissions:\n      contents: read\n      id-token: write\n    name: Build and verify release candidate",
    )),
    /OIDC token/,
  );
  const moved = workflow
    .replace("node scripts/verify-attestations.mjs", "node scripts/__swap.mjs")
    .replace("node scripts/publish-release.mjs", "node scripts/verify-attestations.mjs")
    .replace("node scripts/__swap.mjs", "node scripts/publish-release.mjs");
  assert.throws(() => validateReleaseWorkflowText(moved), /after provenance verification/);
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace("sha256sum --check --strict", "sha256sum --check")),
    /checksum-verified/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace("subject-path: release/SHA256SUMS", "subject-path: release/release-metadata.json")),
    /SHA256SUMS must receive its own attestation/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace('RELEASE_PUBLICATION_ENABLED: "false"', 'RELEASE_PUBLICATION_ENABLED: "true"')),
    /must remain explicitly disabled/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace(
      "    timeout-minutes: 10",
      '    timeout-minutes: 10\n    env:\n      RELEASE_PUBLICATION_ENABLED: "true"',
    )),
    /must not be overridden/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace("name: Enforce release authorization gate", "name: Authorization removed")),
    /authorization gate/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace("-f LICENSE.txt", "-e LICENSE.txt")),
    /must check LICENSE\.txt/,
  );
  assert.throws(
    () => validateReleaseWorkflowText(workflow.replace("! -L LICENSE.txt", "! -d LICENSE.txt")),
    /reject a symlinked LICENSE\.txt/,
  );
});
