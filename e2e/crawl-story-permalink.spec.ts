import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`a newly saved local crawl opens its permalink at ${width}px`, async ({ page, request }) => {
    const title = `Local crawl handoff ${width}`;
    const created = await request.post("/api/crawls", { data: {
      title, visibility: "unlisted", summary: "Disposable keyless route proof.",
      stops: [{ venueId: "venue-e1srzr" }, { venueId: "venue-15i2wst" }],
    } });
    expect(created.status()).toBe(201);
    const { slug } = await created.json();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/crawls/${slug}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText("Shakespeares Head (Soho)", { exact: true })).toBeVisible();
    await expect(page.getByText("Golden Lion (Soho)", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  });
}
