import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });

test("base pub search makes no unsupported price absence claim", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  });
  await page.goto("/map", { waitUntil: "domcontentloaded" });
  const search = page.locator("#mapSearchInput");
  await expect(search).toBeVisible({ timeout: 60_000 });
  await search.fill("Sydney Arms");
  const row = page.locator('.mapSearchSuggestRow[data-venue-id^="venue-uk-"]').filter({ hasText: "Sydney Arms" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  console.log(JSON.stringify({ url: page.url(), row: await row.innerText(), id: await row.getAttribute("data-venue-id") }));
  await page.screenshot({ path: process.env.SEARCH_PROOF_IMAGE, fullPage: false });
  await expect(row).not.toContainText("No listed price");
  await expect(row.locator(".mapSearchSuggestRowName")).toContainText("Sydney Arms");
});
