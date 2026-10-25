import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`Ledger price warnings and own actions stay clear at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/ledger/venue-1vle947", (route) => route.fulfill({ json: {
      pintPrice: {
        dropId: "70bf7fad-cc16-435d-ad7e-022d4c0ba9c1", drink: "Lager", measure: "pint",
        priceGbp: 4.7, createdAt: "2026-09-06T01:22:18.585+00:00",
        handle: "a PUBMAXXER", state: "aged-out", split: null,
      },
      claims: [], entries: [], familyEntries: [],
    } }));
    await page.goto("/ledger/venue-1vle947", { waitUntil: "domcontentloaded" });
    const warning = page.getByText(/Over 30 days old, needs a fresh drinker/).first();
    await expect(warning).toBeVisible();
    await expect(page.getByRole("link", { name: "Open on the map", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "See the bar tab", exact: true })).toBeVisible();
    const drop = page.getByRole("link", { name: "View Pint Drop", exact: true });
    await expect(drop).toBeVisible();
    await expect(drop).toHaveAttribute("href", "/p/70bf7fad-cc16-435d-ad7e-022d4c0ba9c1");
    await page.evaluate(() => window.scrollBy(0, 36));
    await expect.poll(() => warning.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = [...range.getClientRects()].at(-1);
      if (!rect) return false;
      const hit = document.elementFromPoint(rect.right - 3, rect.top + rect.height / 2);
      return hit === node || (hit !== null && node.contains(hit));
    })).toBe(true);
    await expect(page.getByRole("button", { name: "Create", exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("ledger-price-clearance.png"), fullPage: false });
  });
}
