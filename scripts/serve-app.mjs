import { createDigServer } from "../src/http-server.mjs";

function integerEnvironment(name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${name} is outside its supported range.`);
  }
  return parsed;
}

const mode = process.env.DIG_MODE ?? "local";
const allowPrivate = process.env.DIG_ALLOW_PRIVATE === "1";
const app = await createDigServer({
  host: process.env.DIG_HOST ?? "127.0.0.1",
  port: integerEnvironment("DIG_PORT", 4175, 65_535),
  mode,
  allowPrivate,
  accessToken: process.env.DIG_ACCESS_TOKEN,
  origin: process.env.DIG_ORIGIN,
  timeoutMs: integerEnvironment("DIG_TIMEOUT_MS", 5_000, 60_000),
  idleTimeoutMs: integerEnvironment("DIG_IDLE_TIMEOUT_MS", 2_000, 60_000),
  maxBytes: integerEnvironment("DIG_MAX_BYTES", 1_048_576, 10_485_760),
  homeAddress: process.env.DIG_HOME_ADDRESS,
});
const bound = await app.listen();
if (!bound || typeof bound === "string") {
  throw new Error("DIG did not bind to TCP.");
}
process.stdout.write(
  `DIG ${mode} server listening on http://${app.host}:${bound.port}/Dig/\n`,
);
if (allowPrivate) {
  process.stderr.write(
    "WARNING: private and loopback Gopher destinations are enabled for this local process.\n",
  );
}

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
