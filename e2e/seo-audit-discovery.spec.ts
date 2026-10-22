import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`crawl estimate names its straight-line basis at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/crawls");
    await expect(page.locator("main")).toHaveAttribute("data-venue-index-status", "ready");
    const featured = page.locator(".curatedFeaturedCard");
    await expect(featured).toContainText("straight-line estimate");
    await expect(featured).not.toContainText(/\d+ min walk/);
    await expect(featured.getByRole("link", { name: /Plan the Victorian Soho crawl/ }))
      .toHaveAttribute("href", /\/map\?mode=build&pubs=/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}

test.describe("completed public discovery documents without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("crawl directory exposes the named routes and ordered map links", async ({ page }) => {
    const response = await page.goto("/crawls");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "London pub crawl routes" })).toBeVisible();
    for (const name of ["Victorian Soho", "Camden Market crawl", "Borough Market crawl", "Fleet Street & the Writers"]) {
      const link = page.getByRole("link", { name: `Plan the ${name} crawl on the map` });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", /\/map\?mode=build&pubs=venue-/);
    }
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://pubmaxxing.com/crawls");
  });

  test("Pint Index serves its honest empty public state and retained edition", async ({ page }) => {
    const response = await page.goto("/pint-index");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("London pint prices by borough and fare zone | PUBMAXX");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("London pint prices by borough and fare zone");
    await expect(page.getByRole("heading", { name: "By fare zone", exact: true })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page.locator('a[href="/pint-index/2026-06"]').first()).toBeVisible();
    await expect(page.locator('a[href="/pint-index/data.csv"]')).toHaveCount(0);
  });

  test("Tonight exposes recommendations and a completed listing availability answer", async ({ page }) => {
    const response = await page.goto("/tonight");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Pubs Londoners keep recommending" })).toBeVisible();
    await expect(page.locator('[data-testid="tonight-lede"]')).not.toContainText("Loading listings");
    await expect(page.locator('[data-testid="tonight-lede"]')).toContainText(/not available|No confirmed|not set up|not configured|couldn.t|unavailable|Nothing confirmed/i);
  });
});
