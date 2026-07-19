#!/usr/bin/env node
import { fetchGopher } from "../src/client.mjs";
import { itemType, parseGopherUrl, parseMenu, toGopherUrl } from "../site/protocol.mjs";

const address = process.argv[2] ?? "gopher://gopher.floodgap.com/1/";

try {
  const target = parseGopherUrl(address);
  process.stderr.write(`DIG / ${target.host}:${target.port} / ${target.type}${target.selector}\n\n`);
  const payload = await fetchGopher(address);

  if (target.type === "1" || target.type === "7") {
    for (const entry of parseMenu(payload)) {
      const kind = itemType(entry.type);
      const destination = entry.valid
        ? toGopherUrl({ host: entry.host, port: entry.port, type: entry.type, selector: entry.selector })
        : "invalid menu line";
      process.stdout.write(`${kind.icon.padEnd(3)}  ${entry.label}\n     ${destination}\n`);
    }
  } else {
    process.stdout.write(payload);
  }
} catch (error) {
  process.stderr.write(`DIG could not open the address: ${error.message}\n`);
  process.exitCode = 1;
}
