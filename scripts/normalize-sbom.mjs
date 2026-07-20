import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function normalizeCycloneDx(document) {
  assert.equal(document.bomFormat, "CycloneDX", "Expected a CycloneDX document.");
  const normalized = structuredClone(document);
  delete normalized.serialNumber;
  if (normalized.metadata) delete normalized.metadata.timestamp;
  return canonicalize(normalized);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  assert.ok(input && output, "Usage: node scripts/normalize-sbom.mjs <input> <output>");
  const document = JSON.parse(await readFile(input, "utf8"));
  const normalized = normalizeCycloneDx(document);
  await writeFile(output, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}
