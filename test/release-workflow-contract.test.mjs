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
});
