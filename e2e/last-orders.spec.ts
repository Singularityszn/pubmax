import { expect, test, type Page } from "@playwright/test";

// Last orders on /tonight at a frozen 22:45 on a Friday in London (GMT after
// the clocks went back, so the `Z` instant is the wall clock). The document is
// prerendered; the browser reads its own clock, so freezing it is enough to
// mark the door as the night's lead. Shots go to artifacts/last-orders/.

const FRIDAY_2245 = new Date("2026-10-30T22:45:00Z");
const SOHO = { latitude: 51.5136, longitude: -0.1365 };

const VIEWPORTS = [
  { name: "390x844", width: 390, height: 844 },
  { name: "1280x800", width: 1280, height: 800 },
] as const;

async function openTonightAt(page: Page, path = "/tonight") {
  await page.clock.setFixedTime(FRIDAY_2245);
  await page.goto(path);
  const door = page.getByTestId("last-orders-door");
  await expect(door).toHaveAttribute("data-late", "true");
  await door.click();
  const panel = page.getByTestId("last-orders");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Last orders" })).toBeVisible();
  return panel;
}

for (const viewport of VIEWPORTS) {
  test(`leads at 22:45 and lists live countdowns (${viewport.name})`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const panel = await openTonightAt(page);

    const countdowns = panel.getByTestId("last-orders-countdown");
    await expect(countdowns.first()).toBeVisible();
    const labels = await countdowns.allInnerTexts();
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.replace(/\s+/g, " ").trim()).toMatch(/^Open (\d+ more min|until \d{2}:\d{2}|all night)$/);
      const minutes = /Open (\d+) more min/.exec(label.replace(/\s+/g, " "));
      if (minutes) expect(Number(minutes[1])).toBeGreaterThanOrEqual(30);
    }

    // No position shared: walks are from central London, and the get-home
    // line asks for a position instead of naming a train.
    await expect(panel).toContainText("Walks are from central London.");
    const getHome = panel.getByTestId("last-orders-get-home");
    await expect(getHome).toHaveAttribute("data-status", "no-location");
    await expect(getHome).not.toContainText(/\d{2}:\d{2}/);
    await expect(panel).toContainText("Hours from OpenStreetMap");

    // Dark at night by default for a reader who never chose a theme, and
    // nothing is stored on their behalf.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-night-theme", "1");
    expect(await page.evaluate(() => window.localStorage.getItem("pubmax-theme"))).toBeNull();

    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/last-orders/last-orders-${viewport.name}.png` });
  });
}

test("says plainly when there is no last-train time, and invents none", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(SOHO);
  // The graceful-failure shape /api/last-train answers with when TfL has nothing.
  await page.route("**/api/last-train**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ station: null, trains: [], error: "unavailable" }),
    }),
  );
  const panel = await openTonightAt(page);
  await panel.getByTestId("last-orders-share-location").click();

  await expect(panel).toContainText("Walks are from where you are.");
  const getHome = panel.getByTestId("last-orders-get-home");
  await expect(getHome).toHaveAttribute("data-status", "none");
  await expect(getHome).toContainText("We have no last-train time for this spot, so we show none.");
  await expect(getHome).not.toContainText(/\d{2}:\d{2}/);
  await expect(panel.getByTestId("last-orders-countdown").first()).toBeVisible();
  await page.screenshot({ path: "artifacts/last-orders/last-orders-located-390x844.png" });
});

test("before 21:30 the door is quiet, and the address opens the panel at any hour", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-30T18:00:00Z"));
  await page.goto("/tonight");
  const door = page.getByTestId("last-orders-door");
  await expect(door).toBeVisible();
  await expect(door).not.toHaveAttribute("data-late", "true");
  await expect(page.getByTestId("last-orders")).toHaveCount(0);

  await page.goto("/tonight?mode=last-orders");
  await expect(page.getByTestId("last-orders")).toBeVisible();
  // 18:00 is not night: opening the list leaves the theme alone.
  await expect(page.locator("html")).not.toHaveAttribute("data-night-theme", "1");
  await page.getByRole("button", { name: "Close Last orders" }).click();
  await expect(page.getByTestId("last-orders-door")).toBeVisible();
});

test("a reader's own light theme wins over the night default", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => window.localStorage.setItem("pubmax-theme", "light"));
  const panel = await openTonightAt(page);
  await expect(panel.getByTestId("last-orders-countdown").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).not.toHaveAttribute("data-night-theme", "1");
});

test("closing the list at night puts the theme back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTonightAt(page);
  await expect(page.locator("html")).toHaveAttribute("data-night-theme", "1");
  await page.getByRole("button", { name: "Close Last orders" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-night-theme", "1");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("The French House lists no price: its £3.40 is a half pint (390x844)", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(["geolocation"]);
  // On Dean Street, beside it.
  await context.setGeolocation({ latitude: 51.51274, longitude: -0.13171 });
  await page.route("**/api/last-train**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ station: null, trains: [], error: "unavailable" }),
    }),
  );
  // 21:45 on Sunday 1 November: it closes at 22:30, so it is listed. On a
  // Friday the list fills with pubs open later and an unpriced pub sorts last.
  await page.clock.setFixedTime(new Date("2026-11-01T21:45:00Z"));
  await page.goto("/tonight");
  await page.getByTestId("last-orders-door").click();
  const panel = page.getByTestId("last-orders");
  await panel.getByTestId("last-orders-share-location").click();
  await expect(panel).toContainText("Walks are from where you are.");

  const row = panel.locator("li", { hasText: "French House" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("No price yet");
  await expect(panel).not.toContainText("£3.40");
  // The tab bar and the create button float over the page; leave them out of
  // a shot of the whole list so no row is hidden behind them.
  await panel.screenshot({
    path: "artifacts/last-orders/last-orders-soho-full-390.png",
    style: ".mobileTabBar, .createFab { visibility: hidden !important; }",
  });
});
