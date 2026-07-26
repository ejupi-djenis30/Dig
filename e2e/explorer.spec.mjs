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
    if (
      url.origin === LOCAL_ORIGIN ||
      ["blob:", "data:"].includes(url.protocol)
    ) {
      return route.continue();
    }
    outbound.push(url.href);
    return route.abort("blockedbyclient");
  });
});

test.afterEach(async ({ page }) => {
  expect(
    runtimeErrors.get(page) ?? [],
    "The explorer emitted runtime errors",
  ).toEqual([]);
  expect(
    outboundRequests.get(page) ?? [],
    "The explorer made a browser request outside its own origin",
  ).toEqual([]);
});

async function openExplorer(page) {
  await page.goto("./");
  await expect(
    page.getByRole("heading", {
      name: "Follow the protocol, line by line.",
    }),
  ).toBeVisible();
  await expect(page.locator("[data-mode]")).toHaveText("local / live TCP");
  await expect(page.locator("[data-resource] .menu-item")).toHaveCount(6);
  await expect(page.locator("[data-count]")).toHaveText("6 items");
  await expect(page.locator("[data-security-banner]")).toContainText(
    "Private and loopback destinations",
  );
}

test("navigates a real TCP fixture and supports back and forward", async ({
  page,
}) => {
  await openExplorer(page);
  const welcome = page
    .locator("[data-resource] .menu-item")
    .filter({ hasText: "Welcome to DIG" });
  await welcome.click();

  await expect(page.locator("[data-resource-heading]")).toHaveText(
    "TEXT RESPONSE",
  );
  await expect(page.locator(".text-resource")).toContainText(
    "This response came from a real TCP socket.",
  );
  await expect(page.locator(".text-resource")).toContainText(
    ".A dot-stuffed line stays visible.",
  );
  await expect(page.locator("[data-sha]")).toHaveText(/^[a-f0-9]{64}$/u);
  await expect(page.locator("[data-back]")).toBeEnabled();

  await page.locator("[data-back]").click();
  await expect(page.locator("[data-resource-heading]")).toHaveText(
    "GOPHER MENU",
  );
  await expect(page.locator("[data-forward]")).toBeEnabled();

  await page.locator("[data-forward]").click();
  await expect(page.locator("[data-resource-heading]")).toHaveText(
    "TEXT RESPONSE",
  );
});

test("runs a Gopher search, bookmarks the result and exports JSON", async ({
  page,
}) => {
  await openExplorer(page);
  await page
    .locator("[data-resource] .menu-item")
    .filter({ hasText: "Search the archive" })
    .click();
  await expect(page.locator("[data-search-form]")).toBeVisible();
  await page.locator("[data-search-query]").fill("selectors");
  await page.locator("[data-search-form]").getByRole("button", { name: "Search" }).click();

  await expect(page.locator("[data-resource-heading]")).toHaveText(
    "GOPHER MENU",
  );
  await expect(page.locator("[data-resource]")).toContainText(
    "Search result for selectors",
  );
  await page.locator("[data-bookmark]").click();
  await expect(page.locator("[data-bookmark-list] li")).toHaveCount(1);
  await expect(page.locator("[data-bookmark]")).toHaveText("Remove bookmark");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("[data-export]").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/response\.json$/u);
});

test("raw inspection is opt-in and exposes verifiable response metadata", async ({
  page,
}) => {
  await openExplorer(page);
  await expect(page.locator("[data-raw]")).toHaveText(
    "iDeterministic fixture\tignored\tinvalid\t0",
  );
  await page.locator("[data-raw-toggle]").click();
  await expect(page.locator("[data-raw-toggle]")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("[data-raw]")).toContainText(
    "base64 characters / digest verified",
  );
});

test.describe("320px viewport", () => {
  test.use({
    viewport: { width: 320, height: 800 },
    hasTouch: true,
    isMobile: true,
  });

  test("keeps the live explorer and every visible control in the viewport", async ({
    page,
  }) => {
    await openExplorer(page);
    await page.locator("#explorer").scrollIntoViewIfNeeded();
    await page
      .locator("[data-resource] .menu-item")
      .filter({ hasText: "Protocol archive" })
      .click();
    await expect(page.locator("[data-resource]")).toContainText(
      "Request framing",
    );

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
      const interactiveTargets = [
        ...document.querySelectorAll("a[href], button, input"),
      ]
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          const visible =
            typeof element.checkVisibility === "function"
              ? element.checkVisibility({
                  checkOpacity: true,
                  checkVisibilityCSS: true,
                })
              : true;
          return visible && bounds.width > 0 && bounds.height > 0;
        })
        .map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            target:
              element.getAttribute("aria-label") ||
              element.getAttribute("name") ||
              element.textContent?.trim().replace(/\s+/gu, " ") ||
              element.id ||
              element.tagName.toLowerCase(),
            width: bounds.width,
            height: bounds.height,
          };
        });

      return {
        viewport: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        shell: rectangle(".browser-shell"),
        bar: rectangle(".browser-bar"),
        form: rectangle("[data-address-form]"),
        trace: rectangle(".trace-pane"),
        source: rectangle(".github-link"),
        interactiveTargets,
      };
    });

    expect(geometry.viewport).toBe(320);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewport);
    for (const area of [
      geometry.shell,
      geometry.bar,
      geometry.form,
      geometry.trace,
      geometry.source,
    ]) {
      expect(area.left).toBeGreaterThanOrEqual(-1);
      expect(area.right).toBeLessThanOrEqual(geometry.viewport + 1);
    }
    const undersizedTargets = geometry.interactiveTargets.filter(
      ({ width, height }) => width < 44 || height < 44,
    );
    expect(
      undersizedTargets,
      "Every visible control must be at least 44 × 44 CSS pixels.",
    ).toEqual([]);
  });
});
