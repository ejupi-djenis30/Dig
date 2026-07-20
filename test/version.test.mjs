import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const repositoryRoot = new URL("../", import.meta.url);

test("the CLI reports the package release version", async () => {
  const packageMetadata = JSON.parse(await readFile(new URL("package.json", repositoryRoot), "utf8"));
  const { stdout, stderr } = await execute(process.execPath, ["bin/dig.mjs", "--version"], {
    cwd: repositoryRoot,
    windowsHide: true,
  });

  assert.equal(stderr, "");
  assert.equal(stdout, `DIG ${packageMetadata.version}\n`);
});
