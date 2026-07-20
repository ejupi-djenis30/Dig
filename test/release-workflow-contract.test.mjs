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
});
