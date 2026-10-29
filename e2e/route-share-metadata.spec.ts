import { expect, test } from "@playwright/test";

const site = "https://pubmaxxing.com";
const routes = [
  { path: "/map", title: "London pub map", image: "/api/city-map-card?city=london" },
  { path: "/pal", title: "Plan your night with Pub Pal", image: "/pal/circuit-robin-512.png" },
  { path: "/tonight", title: "Tonight in London", image: "/tonight/opengraph-image" },
];

test("the sitemap advertises Pub Pal's public introduction once", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const xml = await response.text();
  expect(xml.match(/<loc>https:\/\/pubmaxxing\.com\/pal<\/loc>/g)).toHaveLength(1);
  expect(xml).not.toContain("/pal/chat");
});

test("Tonight's shared poster still serves a full-sized PNG at its existing URL", async ({ request }) => {
  const response = await request.get("/tonight/opengraph-image");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");
  expect(response.headers()["cache-control"]).toBe("public, max-age=0, s-maxage=300");
  const png = await response.body();
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
  const head = await request.head("/tonight/opengraph-image");
  expect(head.status()).toBe(200);
  expect(head.headers()["cache-control"]).toBe("public, max-age=0, s-maxage=300");
});

for (const route of routes) {
  test(`${route.path} publishes its own metadata without JavaScript`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      expect((await page.goto(route.path))?.status()).toBe(200);
      await expect(page).toHaveTitle(`${route.title} | PUBMAXX`);
      const canonical = page.locator('link[rel="canonical"]');
      await expect(canonical).toHaveCount(1);
      await expect(canonical).toHaveAttribute("href", `${site}${route.path}`);
      for (const [selector, content] of [
        ['meta[property="og:title"]', route.title],
        ['meta[property="og:url"]', `${site}${route.path}`],
        ['meta[property="og:image"]', `${site}${route.image}`],
        ['meta[name="twitter:title"]', route.title],
        ['meta[name="twitter:image"]', `${site}${route.image}`],
      ] as const) {
        const tag = page.locator(selector);
        await expect(tag).toHaveCount(1);
        await expect(tag).toHaveAttribute("content", content);
      }
      if (route.path === "/map") {
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.locator("h1")).toHaveText("London pub map");
      }
    } finally {
      await context.close();
    }
  });
}

for (const width of [390, 1440]) {
  test(`the loaded map retains one London heading at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    expect((await page.goto("/map"))?.status()).toBe(200);
    await expect(page.locator(".mapStage")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText("London pub map");
    await expect(page.locator("h1")).toHaveCSS("position", "absolute");
  });
}
