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

  test("homepage explains planning, accounts and price sources in completed HTML", async ({ page }) => {
    expect((await page.goto("/"))?.status()).toBe(200);
    await expect(page).toHaveTitle("London pint prices and pub crawls with friends | PUBMAXX");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Plan a crawl and share the route with your mates/);
    await expect(page.locator("#faq")).toContainText("public directories");
    await expect(page.locator("#faq")).toContainText("show its read day when known");
    await expect(page.locator("#faq")).toContainText("Browse and save pubs on this device without an account");
    await expect(page.locator("#faq")).toContainText("sign in if asked");
    await expect(page.locator("#faq")).not.toContainText("Each figure shows the day it was collected");
    await expect(page.locator(".lpPubSource")).toContainText(/source read|read day not recorded/);
    await expect(page.locator('.lpStanding[data-standing="listed"]')).toHaveAttribute("title", "A public source lists this price. The source and the day we read it are below.");
    const graph = await page.locator('script[type="application/ld+json"]').first().textContent();
    const nodes = JSON.parse(graph ?? "[]") as Array<Record<string, unknown>>;
    const website = nodes.find((node) => node["@type"] === "WebSite");
    const organization = nodes.find((node) => node["@type"] === "Organization");
    expect(website?.["@id"]).toBe("https://pubmaxxing.com/#website");
    expect(website?.description).toContain("planning crawls with friends and sharing routes");
    expect(organization?.["@id"]).toBe("https://pubmaxxing.com/#organization");
    expect(organization).not.toHaveProperty("sameAs");
    expect(nodes.map((node) => node["@type"])).not.toContain("FAQPage");
  });

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
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Recommendations can expire. The keyless listing availability answer
    // must remain readable even when no recommendation clears its age limit.
    await expect(page.locator('[data-testid="tonight-lede"]')).toBeVisible();
    await expect(page.getByTestId("brief-prepared-at")).toContainText("Source dates can be older");
    await expect(page.getByTestId("brief-prepared-at").locator("time")).toHaveAttribute("datetime", /T.*Z$/);
    await expect(page.locator('[data-testid="tonight-lede"]')).not.toContainText("Loading listings");
    await expect(page.locator('[data-testid="tonight-lede"]')).toContainText(/not available|No confirmed|not set up|not configured|couldn.t|unavailable|Nothing confirmed/i);
  });
});
