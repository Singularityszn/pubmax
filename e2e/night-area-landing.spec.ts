import { expect, test, type Page } from "@playwright/test";

async function setAppState(page: Page, theme: "light" | "dark") {
  await page.addInitScript((nextTheme) => {
    if (!localStorage.getItem("pubmax-theme")) localStorage.setItem("pubmax-theme", nextTheme);
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  }, theme);
}

async function expectNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.body).toBeLessThanOrEqual(geometry.viewport);
}

test("390px governed area page ranks prices and names each publisher", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setAppState(page, "light");

  const response = await page.goto("/area/clapham");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Cheapest pints in Clapham" })).toBeVisible();
  await expect(page.getByText("35 pubs with listed Pint Prices. Collected 3 July 2026.")).toBeVisible();

  const rows = page.locator(".areaLanding tbody tr");
  await expect(rows).toHaveCount(35);
  await expect(rows.first()).toContainText("The Hand in Hand");
  await expect(rows.first()).toContainText("£3.10");
  await expect(rows.first().getByRole("link", { name: "Pint Prices" })).toHaveAttribute(
    "href",
    /^https:\/\/www\.pint-prices\.com\/pub\//,
  );
  await expect(page.getByRole("link", { name: "Open Clapham on Map" })).toHaveAttribute(
    "href",
    "/map?q=Clapham",
  );
  await expect(page.getByRole("link", { name: "Plan a pub crawl" })).toHaveAttribute("href", "/plan");

  const touchHeights = await page.locator(".areaLanding__actions a").evaluateAll((links) =>
    links.map((link) => link.getBoundingClientRect().height));
  expect(touchHeights.every((height) => height >= 44)).toBe(true);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "docs/proof/night-area-landing/clapham-390-light.png" });

  await page.evaluate(() => localStorage.setItem("pubmax-theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "docs/proof/night-area-landing/clapham-390-dark.png" });
});

test("1440px area page keeps keyboard focus visible and opens its canonical Map query", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setAppState(page, "light");
  await page.goto("/area/victoria");

  const mapLink = page.getByRole("link", { name: "Open Victoria on Map" });
  await mapLink.focus();
  await expect(mapLink).toBeFocused();
  const outline = await mapLink.evaluate((link) => getComputedStyle(link).outlineStyle);
  expect(outline).not.toBe("none");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: "docs/proof/night-area-landing/victoria-1440-focus.png" });

  await mapLink.click();
  await expect(page).toHaveURL(/\/map\?q=Victoria$/);
});

test("unpublished areas return 404", async ({ page }) => {
  const response = await page.goto("/area/camden");
  expect(response?.status()).toBe(404);
});
