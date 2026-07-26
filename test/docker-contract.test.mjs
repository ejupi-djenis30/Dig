import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import YAML from "yaml";

const root = new URL("../", import.meta.url);

test("container runs unprivileged and starts only the authenticated hosted gateway", async () => {
  const dockerfile = await readFile(new URL("Dockerfile", root), "utf8");
  assert.match(dockerfile, /^FROM node:22\.23\.1-alpine$/mu);
  assert.match(dockerfile, /^USER node$/mu);
  assert.match(dockerfile, /^HEALTHCHECK /mu);
  assert.match(
    dockerfile,
    /^CMD \["node", "bin\/dig\.mjs", "serve", "--host", "0\.0\.0\.0", "--port", "4175", "--hosted"\]$/mu,
  );
  assert.doesNotMatch(dockerfile, /^COPY \. /mu);
});

test("Compose publishes only on loopback and bounds container privileges and logs", async () => {
  const composeText = await readFile(new URL("compose.yaml", root), "utf8");
  const compose = YAML.parse(composeText);
  const service = compose.services?.dig;
  assert.ok(service);
  assert.deepEqual(service.ports, ["127.0.0.1:4175:4175"]);
  assert.match(
    service.environment.DIG_ACCESS_TOKEN,
    /^\$\{DIG_ACCESS_TOKEN:\?/u,
  );
  assert.equal(
    service.environment.DIG_ORIGIN,
    "${DIG_ORIGIN:-http://127.0.0.1:4175}",
  );
  assert.equal(service.read_only, true);
  assert.equal(service.pids_limit, 100);
  assert.deepEqual(service.cap_drop, ["ALL"]);
  assert.deepEqual(service.security_opt, ["no-new-privileges:true"]);
  assert.ok(
    service.tmpfs.some(
      (value) =>
        value.includes("noexec") &&
        value.includes("nosuid") &&
        value.includes("nodev"),
    ),
  );
  assert.deepEqual(service.logging, {
    driver: "json-file",
    options: { "max-size": "10m", "max-file": "3" },
  });
});

test("Docker build context excludes secrets and development state", async () => {
  const ignored = await readFile(new URL(".dockerignore", root), "utf8");
  for (const entry of [
    ".env",
    ".env.*",
    ".git",
    ".serena",
    "node_modules",
    "test-results",
  ]) {
    assert.ok(
      ignored.split(/\r?\n/u).includes(entry),
      `.dockerignore must include ${entry}`,
    );
  }
});
