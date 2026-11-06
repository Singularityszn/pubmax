import { expect, test } from "@playwright/test";

// A stop price is a price submission, so a signed-out save carrying one meets
// the price door's sign-in refusal and stores nothing (__tests__/crawlStopPriceAge.test.ts
// holds the age branches). The priced poster keeps its fixture audit.
test("a signed-out crawl save with a stop price is refused before anything is stored", async ({ request }) => {
  const refused = await request.post("/api/crawls", { data: {
    title: "Local crawl handoff priced", visibility: "unlisted", summary: "Disposable keyless route proof.",
    stops: [{ venueId: "venue-e1srzr", priceGbp: 5.4 }, { venueId: "venue-15i2wst" }],
  } });
  expect(refused.status()).toBe(401);
  expect(await refused.json()).toEqual({ status: "sign_in_required", error: "Sign in to contribute." });
});

for (const width of [390, 1440]) {
  test(`a newly saved local crawl opens its permalink at ${width}px with unknown prices`, async ({ page, request }) => {
    const title = `Local crawl handoff ${width} unknown`;
    const created = await request.post("/api/crawls", { data: {
      title, visibility: "unlisted", summary: "Disposable keyless route proof.",
      stops: [{ venueId: "venue-e1srzr", priceGbp: null }, { venueId: "venue-15i2wst" }],
    } });
    expect(created.status()).toBe(201);
    const { slug } = await created.json();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/crawls/${slug}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText("Shakespeares Head (Soho)", { exact: true })).toBeVisible();
    await expect(page.getByText("Golden Lion (Soho)", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Crawl total", exact: true })).toContainText("Prices unknown");
    await expect(page.getByRole("group", { name: "Crawl total", exact: true })).not.toContainText("£0.00");
    expect(await page.locator('meta[property="og:image"]').getAttribute("content")).not.toContain("total=");
    await expect(page.getByRole("link", { name: "Share on WhatsApp", exact: true })).not.toHaveAttribute("href", /a%20round/);
    await page.reload();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  });
}
