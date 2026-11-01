import { expect, test } from "@playwright/test";

test.describe("prepared briefs after hydration", () => {
  test.use({ timezoneId: "America/New_York" });

  for (const route of ["/today", "/tonight"]) {
    test(`${route} keeps its serialized London preparation label after hydration`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const response = await page.goto(route);
      const html = await response!.text();
      const serialized = await page.evaluate((documentHtml) =>
        new DOMParser().parseFromString(documentHtml, "text/html")
          .querySelector('[data-testid="brief-prepared-at"] time')?.textContent,
      html);
      expect(serialized).toMatch(/ (?:GMT|BST)$/);

      // A successful theme toggle proves the client has attached before comparing.
      const theme = page.getByRole("button", { name: /Switch to .* theme/ });
      const initialLabel = await theme.getAttribute("aria-label");
      await expect(async () => {
        await theme.click();
        await expect(theme).not.toHaveAttribute("aria-label", initialLabel!, { timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      await expect(page.getByTestId("brief-prepared-at").locator("time")).toHaveText(serialized!);
      expect(errors).toEqual([]);
    });
  }
});

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

  test("homepage explains planning and price sources in completed HTML", async ({ page }) => {
    expect((await page.goto("/"))?.status()).toBe(200);
    await expect(page).toHaveTitle("London pint prices and pub crawls with friends | PUBMAXX");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Plan a crawl and share the route with your mates/);
    await expect(page.locator("#faq")).toContainText("public directories");
    await expect(page.locator("#faq")).toContainText("source read days where known");
    await expect(page.locator("#faq")).toContainText("sign in if asked");
    await expect(page.locator(".lpPubSource")).toContainText(/source read|read day not recorded/);
    await expect(page.locator('.lpStanding[data-standing="listed"]')).toHaveAttribute("title", "A public source lists this price. Its source and read day are shown when recorded.");
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

  for (const record of [
    { slug: "prospect-of-whitby", sameAs: ["https://en.wikipedia.org/wiki/Prospect_of_Whitby"] },
    { slug: "the-grapes", sameAs: ["https://en.wikipedia.org/wiki/The_Grapes,_Limehouse"] },
    { slug: "black-lion", sameAs: null },
  ] as const) {
    test(`historic ${record.slug} serves its grounded identity and canonical without JavaScript`, async ({ page }) => {
      expect((await page.goto(`/historic/${record.slug}`))?.status()).toBe(200);
      const canonical = `https://pubmaxxing.com/historic/${record.slug}`;
      const link = page.locator('link[rel="canonical"]');
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute("href", canonical);
      const graphs = await page.locator('script[type="application/ld+json"]').allTextContents();
      const nodes = graphs.flatMap((text) => {
        const parsed = JSON.parse(text) as Record<string, unknown> | Array<Record<string, unknown>>;
        return Array.isArray(parsed) ? parsed : [parsed];
      });
      const landmarks = nodes.filter((node) => node["@type"] === "LandmarksOrHistoricalBuildings");
      if (record.slug === "black-lion") {
        // The two cited identities remain unresolved. The served page must not
        // assert that their descriptions or locations identify one building.
        expect(landmarks).toHaveLength(0);
        const pages = nodes.filter((node) => node["@type"] === "WebPage" && node.url === canonical);
        expect(pages).toHaveLength(1);
        expect(pages[0]?.name).toBe("Black Lion");
        for (const claim of ["sameAs", "description", "address", "geo"]) {
          expect(pages[0]).not.toHaveProperty(claim);
        }
      } else {
        expect(landmarks).toHaveLength(1);
        expect(landmarks[0]?.url).toBe(canonical);
        expect(landmarks[0]?.sameAs).toEqual(record.sameAs);
      }
      if (record.slug === "the-grapes") {
        await expect(page.locator('a[href="https://www.alastairhiltonphotographer.com/product-page/the-grapes"]').first()).toBeVisible();
      }
      if (record.slug === "black-lion") {
        for (const source of ["https://en.wikipedia.org/wiki/Black_Lion,_Kilburn", "https://en.wikipedia.org/wiki/Black_Lion,_Hammersmith"]) {
          await expect(page.locator(`a[href="${source}"]`).first()).toBeVisible();
        }
      }
    });
  }

  test("About explains anonymous saves and account features without JavaScript", async ({ page }) => {
    expect((await page.goto("/about"))?.status()).toBe(200);
    const description = page.locator('section[aria-labelledby="map"]');
    await expect(description).toContainText("Browse and save pubs on this device without an account");
    await expect(description).toContainText("send an invite link to your mates");
    await expect(description).toContainText("Sign in to sync your saves, log prices and use Social when it is available");
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
