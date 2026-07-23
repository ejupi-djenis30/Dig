import { expect, test } from "@playwright/test";

const LOCAL_ORIGIN = "http://127.0.0.1:4175";
const runtimeErrors = new WeakMap();
const outboundRequests = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  const outbound = [];
  runtimeErrors.set(page, errors);
  outboundRequests.set(page, outbound);

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === LOCAL_ORIGIN || ["blob:", "data:"].includes(url.protocol)) {
      return route.continue();
    }
    outbound.push(url.href);
    return route.abort("blockedbyclient");
  });
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) ?? [], "The explorer emitted runtime errors").toEqual([]);
  expect(outboundRequests.get(page) ?? [], "The explorer made an outbound request").toEqual([]);
});

async function openExplorer(page) {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Follow the protocol, line by line." })).toBeVisible();
  await expect(page.locator("[data-menu] .menu-item")).toHaveCount(8);
  await expect(page.locator("[data-count]")).toHaveText("8 items");
}

test("loads the recorded menu, inspects a line, and replays the fixture", async ({ page }) => {
  await openExplorer(page);

  const menuItems = page.locator("[data-menu] .menu-item");
  await expect(menuItems.first()).toHaveAttribute("aria-current", "true");
  await expect(page.locator("[data-type]")).toHaveText("INF");
  await expect(page.locator("[data-type-name]")).toHaveText("i · Information");
  await expect(page.locator("[data-label]")).toHaveText("DIG ARCHIVE — a recorded Gopher menu");
  await expect(page.locator("[data-selector]")).toHaveText("fake");

  const search = menuItems.filter({ hasText: "Search the archive" });
  await search.click();
  await expect(search).toHaveAttribute("aria-current", "true");
  await expect(page.locator("[data-type]")).toHaveText("ASK");
  await expect(page.locator("[data-type-name]")).toHaveText("7 · Search");
  await expect(page.locator("[data-label]")).toHaveText("Search the archive");
  await expect(page.locator("[data-selector]")).toHaveText("/search");
  await expect(page.locator("[data-host]")).toHaveText("dig.local");
  await expect(page.locator("[data-port]")).toHaveText("70");
  await expect(page.locator("[data-raw]")).toHaveText(
    "7Search the archive /search dig.local 70",
  );
  await expect(page.locator("[data-trace-announcement]")).toHaveText(
    "Search the archive. Search. Selector /search, host dig.local, port 70.",
  );

  await page.getByRole("button", { name: "Replay" }).click();
  const replayedFirstItem = page.locator("[data-menu] .menu-item").first();
  await expect(replayedFirstItem).toBeFocused();
  await expect(replayedFirstItem).toHaveAttribute("aria-current", "true");
  await expect(page.locator("[data-label]")).toHaveText("DIG ARCHIVE — a recorded Gopher menu");
  await expect(page.locator("[data-fixture-status]")).toHaveText(
    "The local Gopher recording was replayed. No remote request was made.",
  );
});

test.describe("320px viewport", () => {
  test.use({
    viewport: { width: 320, height: 800 },
    hasTouch: true,
    isMobile: true,
  });

  test("keeps the landing page and interactive trace inside the viewport", async ({ page }) => {
    await openExplorer(page);
    await page.locator("#explorer").scrollIntoViewIfNeeded();

    const protocolSpecimens = page
      .locator("[data-menu] .menu-item")
      .filter({ hasText: "Protocol specimens" });
    await protocolSpecimens.click();
    await expect(page.locator("[data-label]")).toHaveText("Protocol specimens");
    await expect(page.locator("[data-selector]")).toHaveText("/specimens");

    const geometry = await page.evaluate(() => {
      const rectangle = (selector) => {
        const bounds = document.querySelector(selector).getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          width: bounds.width,
          height: bounds.height,
        };
      };

      return {
        viewport: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        shell: rectangle(".browser-shell"),
        bar: rectangle(".browser-bar"),
        form: rectangle("[data-address-form]"),
        replay: rectangle("[data-address-form] button"),
        selectedItem: rectangle('.menu-item[aria-current="true"]'),
        trace: rectangle(".trace-pane"),
        source: rectangle(".github-link"),
      };
    });

    expect(geometry.viewport).toBe(320);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewport);

    for (const area of [
      geometry.shell,
      geometry.bar,
      geometry.form,
      geometry.replay,
      geometry.selectedItem,
      geometry.trace,
      geometry.source,
    ]) {
      expect(area.left).toBeGreaterThanOrEqual(-1);
      expect(area.right).toBeLessThanOrEqual(geometry.viewport + 1);
    }

    expect(geometry.form.left).toBeGreaterThanOrEqual(geometry.shell.left - 1);
    expect(geometry.form.right).toBeLessThanOrEqual(geometry.shell.right + 1);
    expect(geometry.replay.height).toBeGreaterThanOrEqual(44);
    expect(geometry.selectedItem.height).toBeGreaterThanOrEqual(44);
    expect(geometry.source.height).toBeGreaterThanOrEqual(44);
  });
});
