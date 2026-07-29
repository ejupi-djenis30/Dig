import { expect, test } from "@playwright/test";

const LOCAL_ORIGIN = "http://127.0.0.1:4175";
const runtimeErrors = new WeakMap();
const outboundRequests = new WeakMap();

test.beforeEach(async ({ page, browserName }) => {
  const errors = [];
  const outbound = [];
  runtimeErrors.set(page, errors);
  outboundRequests.set(page, outbound);

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    const webkitPlaywrightStyleNoise =
      browserName === "webkit" &&
      text.startsWith(
        "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline'",
      );
    if (!webkitPlaywrightStyleNoise) errors.push(text);
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

test("clears stale actions on failure and retries the same request", async ({ page }) => {
  await openExplorer(page);
  let failNextFetch = true;
  await page.route("**/Dig/api/fetch", async (route) => {
    if (!failNextFetch) {
      await route.fallback();
      return;
    }
    failNextFetch = false;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "CAPACITY_REACHED",
          message: "Temporary test failure.",
        },
      }),
    });
  });

  await page.locator("[data-address-form]").getByRole("button", { name: "Open" }).click();
  await expect(page.locator("[data-resource-heading]")).toHaveText("REQUEST FAILED");
  runtimeErrors.set(page, []);
  await expect(page.locator("[data-resource] .error-resource")).toContainText(
    "Temporary test failure.",
  );
  await expect(page.locator("[data-bookmark]")).toBeDisabled();
  await expect(page.locator("[data-raw-toggle]")).toBeDisabled();
  await expect(page.locator("[data-share]")).toBeDisabled();
  await expect(page.locator("[data-export]")).toBeDisabled();
  await expect(page.locator("[data-label]")).toHaveText("No current resource");
  await expect(page.locator("[data-resource-heading]")).toBeFocused();

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator("[data-resource] .menu-item")).toHaveCount(6);
  await expect(page.locator("[data-resource-heading]")).toHaveText("GOPHER MENU");
  await expect(page.locator("[data-export]")).toBeEnabled();
});

test("fixture mode exposes only controls with useful offline behavior", async ({ page }) => {
  await page.route("**/Dig/api/config", (route) =>
    route.fulfill({ status: 404, body: "not available" }),
  );
  await page.goto("./");

  await expect(page.locator("[data-mode]")).toHaveText("fixture / offline-safe");
  runtimeErrors.set(page, []);
  await expect(page.locator("[data-resource] .menu-item")).toHaveCount(8);
  await expect(page.locator("[data-home]")).toBeDisabled();
  await expect(page.locator("[data-bookmark]")).toBeDisabled();
  await expect(page.locator("[data-raw-toggle]")).toBeDisabled();
  await expect(page.locator("[data-share]")).toBeEnabled();
  await expect(page.locator("[data-export]")).toBeEnabled();
  await expect(page.locator("[data-address]")).toHaveAttribute("readonly", "");
  await expect(page.locator("[data-fixture-status]")).toContainText(
    "no remote Gopher request",
  );
});

test("reloads the installed app shell and fixture while offline", async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Chromium exposes deterministic service-worker controls.");
  const context = await browser.newContext({
    serviceWorkers: "allow",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(`${LOCAL_ORIGIN}/Dig/`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-mode]")).toHaveText(
      "fixture / offline-safe",
    );
    await expect(page.locator("[data-resource] .menu-item")).toHaveCount(8);
    await expect(page.locator("[data-fixture-status]")).toContainText(
      "no remote Gopher request",
    );

    await context.setOffline(false);
    await expect(page.locator("[data-mode]")).toHaveText("local / live TCP");
    await expect(page.locator("[data-resource] .menu-item")).toHaveCount(6);
  } finally {
    await context.close();
  }
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

  test("switches an inspected menu item into a visible Trace panel", async ({ page }) => {
    await openExplorer(page);
    await page.locator("[data-resource] .menu-item").first().click();

    await expect(page.locator("[data-panel-container]")).toHaveAttribute(
      "data-mobile-panel",
      "trace",
    );
    await expect(page.locator("[data-trace-panel]")).toBeVisible();
    await expect(page.locator("[data-label]")).toHaveText(
      "Deterministic fixture",
    );
    await expect(page.locator("[data-trace-tab]")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.locator("[data-resource-tab]").click();
    await expect(page.locator("[data-resource]")).toBeVisible();
    await expect(page.locator("[data-resource-tab]")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
