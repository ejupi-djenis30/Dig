import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { parseChecksumManifest, verifyReleaseAttestations } from "../scripts/verify-attestations.mjs";

const COMMIT = "a".repeat(40);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("checksum parsing rejects traversal, duplicates, and unsorted entries", () => {
  const alpha = digest("alpha");
  const beta = digest("beta");
  assert.throws(() => parseChecksumManifest(`${alpha}  ../asset\n`), /Malformed|Unsafe/);
  assert.throws(() => parseChecksumManifest(`${alpha}  asset\n${alpha}  asset\n`), /duplicates/);
  assert.throws(() => parseChecksumManifest(`${beta}  zeta\n${alpha}  alpha\n`), /lexical/);
});

test("every artifact attestation is identity-bound and retried before release publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "dig-attestation-"));
  await mkdir(join(root, "release"));
  const directory = join(root, "release");
  await writeFile(join(directory, "alpha.txt"), "alpha");
  await writeFile(join(directory, "beta.txt"), "beta");
  await writeFile(
    join(directory, "SHA256SUMS"),
    `${digest("alpha")}  alpha.txt\n${digest("beta")}  beta.txt\n`,
  );
  const calls = [];
  let first = true;
  const run = (args) => {
    calls.push(args);
    if (first) {
      first = false;
      return { status: 1, stdout: "", stderr: "HTTP 503" };
    }
    return { status: 0, stdout: "[{}]", stderr: "" };
  };
  try {
    await verifyReleaseAttestations({
      directory,
      repository: "owner/repository",
      signerWorkflow: "owner/repository/.github/workflows/release.yml",
      sourceCommit: COMMIT,
      sourceRef: "refs/tags/v2.1.2",
      run,
      pause: async () => {},
    });
    assert.equal(calls.length, 4);
    assert.ok(calls.some((args) => args[2].endsWith("SHA256SUMS")));
    for (const args of calls) {
      assert.ok(args.includes("--signer-workflow"));
      assert.ok(args.includes("--source-digest"));
      assert.ok(args.includes("--source-ref"));
      assert.ok(args.includes("--predicate-type"));
      assert.ok(args.includes("--deny-self-hosted-runners"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local artifact tampering fails before an attestation lookup", async () => {
  const root = await mkdtemp(join(tmpdir(), "dig-attestation-tamper-"));
  await writeFile(join(root, "asset.txt"), "changed");
  await writeFile(join(root, "SHA256SUMS"), `${digest("expected")}  asset.txt\n`);
  const calls = [];
  try {
    await assert.rejects(
      () =>
        verifyReleaseAttestations({
          directory: root,
          repository: "owner/repository",
          signerWorkflow: "owner/repository/.github/workflows/release.yml",
          sourceCommit: COMMIT,
          sourceRef: "refs/tags/v2.1.2",
          run: (args) => {
            calls.push(args);
            return { status: 0, stdout: "[{}]", stderr: "" };
          },
          pause: async () => {},
        }),
      /changed after attestation/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
