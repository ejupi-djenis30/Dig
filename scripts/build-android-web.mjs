import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const siteRoot = resolve(repositoryRoot, "site");
const outputRoot = resolve(repositoryRoot, "dist", "android");
const entryPoint = resolve(repositoryRoot, "mobile", "entry.mjs");
const repositorySourceUrl = "https://github.com/ejupi-djenis30/Dig";
const exclusionNames = ["source", "cli-link", "app-meta", "footer-links"];

function assertConfined(path) {
  const pathFromRoot = relative(repositoryRoot, path);
  if (
    !pathFromRoot ||
    pathFromRoot.startsWith("..") ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`Refusing to write outside the repository: ${path}`);
  }
}

function stripAndroidExclusions(source) {
  let result = source;
  for (const name of exclusionNames) {
    const exclusion = new RegExp(
      `\\s*<!-- android-exclude:${name}:start -->[\\s\\S]*?`
        + `<!-- android-exclude:${name}:end -->`,
      "gu",
    );
    const matches = result.match(exclusion) ?? [];
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one Android ${name} exclusion block.`);
    }
    result = result.replace(exclusion, "");
  }
  return result;
}

async function assertNoRepositorySourceLink(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await assertNoRepositorySourceLink(path);
      continue;
    }
    const contents = await readFile(path);
    if (contents.includes(Buffer.from(repositorySourceUrl))) {
      throw new Error(`The Android bundle still contains the repository Source URL: ${path}`);
    }
  }
}

export async function buildAndroidWeb() {
  assertConfined(outputRoot);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(dirname(outputRoot), { recursive: true });
  await cp(siteRoot, outputRoot, { recursive: true });

  const indexPath = resolve(outputRoot, "index.html");
  const sourceIndex = await readFile(indexPath, "utf8");
  const androidIndex = stripAndroidExclusions(sourceIndex)
    .replace(
      '<html lang="en">',
      '<html lang="en" data-runtime="android">',
    );
  if (
    androidIndex.includes('class="github-link"') ||
    /\bSource\s*<span/iu.test(androidIndex)
  ) {
    throw new Error("The Android bundle still contains the Source link.");
  }
  await writeFile(indexPath, androidIndex, "utf8");

  const fixturePath = resolve(outputRoot, "fixtures", "root.txt");
  const sourceFixture = await readFile(fixturePath, "utf8");
  const sourceMenuEntry =
    /^hProject source\tURL:https:\/\/github\.com\/ejupi-djenis30\/Dig\tdig\.local\t70\r?\n?/gmu;
  const sourceMenuMatches = sourceFixture.match(sourceMenuEntry) ?? [];
  if (sourceMenuMatches.length !== 1) {
    throw new Error("Expected exactly one Android fixture Source entry.");
  }
  await writeFile(fixturePath, sourceFixture.replace(sourceMenuEntry, ""), "utf8");

  await build({
    entryPoints: [entryPoint],
    outfile: resolve(outputRoot, "app.mjs"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome120"],
    minify: true,
    sourcemap: false,
    legalComments: "none",
    charset: "utf8",
    logLevel: "warning",
  });

  await assertNoRepositorySourceLink(outputRoot);
  return outputRoot;
}

const isMainModule =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  await buildAndroidWeb();
  process.stdout.write(`${outputRoot}\n`);
}
