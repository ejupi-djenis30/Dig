import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseDocument } from "yaml";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const pinnedUse = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[0-9a-f]{40}$/;

async function workflow(name) {
  const source = await readFile(resolve(repositoryRoot, `.github/workflows/${name}`), "utf8");
  const document = parseDocument(source, { schema: "core", strict: true, uniqueKeys: true, merge: false });
  assert.deepEqual(document.errors, [], `${name} must be valid, duplicate-free YAML.`);
  return document.toJS();
}

function collectUses(value, uses = []) {
  if (Array.isArray(value)) value.forEach((child) => collectUses(child, uses));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "uses") uses.push(child);
      collectUses(child, uses);
    }
  }
  return uses;
}

test("CI pins Ubuntu and exact maintained Node.js patch releases", async () => {
  const ci = await workflow("ci.yml");
  assert.deepEqual(ci.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(ci.jobs).sort(), ["browser-e2e", "test"]);
  assert.equal(ci.jobs.test.name, "test (${{ matrix.node }})");
  assert.equal(ci.jobs.test["runs-on"], "ubuntu-24.04");
  assert.deepEqual(ci.jobs.test.strategy.matrix.include, [
    { node: 20, "node-version": "20.20.2", "npm-version": "10.8.2" },
    { node: 22, "node-version": "22.23.1", "npm-version": "10.9.8" },
  ]);
  const commands = ci.jobs.test.steps.flatMap((step) => typeof step.run === "string" ? [step.run] : []);
  assert.ok(commands.some((command) => command.includes('"v${EXPECTED_NODE_VERSION}"')));
  assert.ok(commands.some((command) => command.includes('"${EXPECTED_NPM_VERSION}"')));
  assert.ok(commands.includes("npm audit --audit-level=moderate"));
  assert.ok(commands.every((command) => !command.includes("npm audit --omit=dev")));

  const browser = ci.jobs["browser-e2e"];
  assert.equal(browser.name, "Chromium E2E");
  assert.equal(browser["runs-on"], "ubuntu-24.04");
  assert.equal(browser["timeout-minutes"], 10);
  assert.ok(browser.steps.some((step) => step.with?.["node-version"] === "22.23.1"));
  assert.ok(browser.steps.some((step) => step.run === "npm ci --ignore-scripts"));
  assert.ok(
    browser.steps.some(
      (step) => step.run === "npx --no-install playwright install --with-deps chromium",
    ),
  );
  assert.ok(browser.steps.some((step) => step.run === "npm run test:e2e"));
  assert.ok(
    browser.steps.some(
      (step) =>
        step.uses === "actions/upload-artifact@330a01c490aca151604b8cf639adc76d48f6c5d4" &&
        step.if === "${{ failure() }}",
    ),
  );
  for (const reference of collectUses(ci)) assert.match(reference, pinnedUse);
});

test("Pages build has read-only source access and deployment alone receives Pages OIDC", async () => {
  const pages = await workflow("pages.yml");
  assert.deepEqual(pages.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(pages.jobs).sort(), ["build", "deploy"]);
  const { build, deploy } = pages.jobs;
  assert.equal(build["runs-on"], "ubuntu-24.04");
  assert.deepEqual(build.permissions, { contents: "read" });
  assert.equal(build.steps.some((step) => step.uses?.startsWith("actions/deploy-pages@")), false);
  assert.ok(build.steps.some((step) => step.with?.["node-version"] === "22.23.1"));
  assert.ok(build.steps.some((step) => step.run?.includes("npm audit --audit-level=moderate")));

  assert.equal(deploy.needs, "build");
  assert.equal(deploy["runs-on"], "ubuntu-24.04");
  assert.deepEqual(deploy.permissions, { pages: "write", "id-token": "write" });
  assert.equal("contents" in deploy.permissions, false);
  assert.deepEqual(deploy.steps.map(({ uses }) => uses), [
    "actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128",
  ]);
  for (const reference of collectUses(pages)) assert.match(reference, pinnedUse);
});
