import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const resourceRoot = resolve(
  repositoryRoot,
  "android",
  "app",
  "src",
  "main",
  "res",
);
const maskable = await readFile(
  resolve(repositoryRoot, "site", "assets", "dig-mark-maskable.svg"),
  "utf8",
);
const foreground = maskable.replace(
  /\s*<rect width="64" height="64" fill="#d8ff3e"\s*\/>/u,
  "",
);

function svgUrl(source) {
  return `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;
}

const browser = await chromium.launch();

async function renderLauncher(path, size, round) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><html><head><style>
      *{box-sizing:border-box}
      html,body{width:100%;height:100%;margin:0}
      body{display:grid;place-items:center;background:transparent}
      .tile{
        display:grid;
        place-items:center;
        width:88%;
        height:88%;
        overflow:hidden;
        border-radius:${round ? "50%" : "22%"};
        background:#d8ff3e;
      }
      img{display:block;width:80%;height:80%}
    </style></head><body><div class="tile"><img alt="" src="${svgUrl(foreground)}"></div></body></html>`,
    { waitUntil: "load" },
  );
  await page.locator("img").evaluate((image) => image.decode());
  await page.screenshot({
    path: resolve(resourceRoot, path),
    omitBackground: true,
  });
  await page.close();
}

const launcherSizes = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

for (const [density, iconSize] of Object.entries(launcherSizes)) {
  await renderLauncher(`mipmap-${density}/ic_launcher.png`, iconSize, false);
  await renderLauncher(`mipmap-${density}/ic_launcher_round.png`, iconSize, true);
  await rm(
    resolve(resourceRoot, `mipmap-${density}`, "ic_launcher_foreground.png"),
    { force: true },
  );
}

const obsoleteSplashes = [
  ["drawable/splash.png", 480, 320],
  ["drawable-land-mdpi/splash.png", 480, 320],
  ["drawable-land-hdpi/splash.png", 800, 480],
  ["drawable-land-xhdpi/splash.png", 1280, 720],
  ["drawable-land-xxhdpi/splash.png", 1600, 960],
  ["drawable-land-xxxhdpi/splash.png", 1920, 1280],
  ["drawable-port-mdpi/splash.png", 320, 480],
  ["drawable-port-hdpi/splash.png", 480, 800],
  ["drawable-port-xhdpi/splash.png", 720, 1280],
  ["drawable-port-xxhdpi/splash.png", 960, 1600],
  ["drawable-port-xxxhdpi/splash.png", 1280, 1920],
];

for (const [path] of obsoleteSplashes) {
  await rm(resolve(resourceRoot, path), { force: true });
}

await browser.close();
process.stdout.write("Android launcher assets generated and legacy splash PNGs removed.\n");
