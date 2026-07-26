import { createDigServer } from "../src/http-server.mjs";
import { createFixtureServer } from "./gopher-fixture.mjs";

const fixture = createFixtureServer();
const fixtureAddress = await fixture.listen();
const app = await createDigServer({
  host: "127.0.0.1",
  port: 4175,
  mode: "local",
  allowPrivate: true,
  homeAddress: fixtureAddress.url,
  timeoutMs: 1_000,
  idleTimeoutMs: 500,
  maxBytes: 1_048_576,
  rateLimit: 1_000,
});
await app.listen();
process.stdout.write(
  `DIG test app listening on http://127.0.0.1:4175/Dig/ with ${fixtureAddress.url}\n`,
);

const shutdown = async () => {
  await app.close();
  await fixture.close();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
