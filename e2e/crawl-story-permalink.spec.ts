import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  for (const price of [null, 5.4]) {
  test(`a newly saved local crawl opens its permalink at ${width}px with ${price === null ? "unknown" : "partial"} prices`, async ({ page, request }) => {
    const title = `Local crawl handoff ${width} ${price ?? "unknown"}`;
    const created = await request.post("/api/crawls", { data: {
      title, visibility: "unlisted", summary: "Disposable keyless route proof.",
      stops: [{ venueId: "venue-e1srzr", priceGbp: price }, { venueId: "venue-15i2wst" }],
    } });
    expect(created.status()).toBe(201);
    const { slug } = await created.json();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/crawls/${slug}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText("Shakespeares Head (Soho)", { exact: true })).toBeVisible();
    await expect(page.getByText("Golden Lion (Soho)", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Crawl total", exact: true })).toContainText(price === null ? "Prices unknown" : "Recorded subtotal");
    await expect(page.getByRole("group", { name: "Crawl total", exact: true })).not.toContainText("£0.00");
    if (price !== null) await expect(page.getByRole("group", { name: "Crawl total", exact: true })).toContainText("£5.40");
    expect(await page.locator('meta[property="og:image"]').getAttribute("content")).not.toContain("total=");
    await expect(page.getByRole("link", { name: "Share on WhatsApp", exact: true })).not.toHaveAttribute("href", /a%20round/);
    await page.reload();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  });
  }
}
