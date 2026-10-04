import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { dismissMapIntroductions } from "./helpers/mapIntroDismissal";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

const venueId = "venue-uk-n1116251530";
const sourceUrl = "https://www.thebetjemanarms.co.uk/menus";
type PublishedQuote = {
  venueId: string; category: string; priceGbp: number; sourceUrl: string;
  observedAt: string; servingSize?: string | null; standing?: string;
};
const rows = JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8")) as PublishedQuote[];
const quote = rows.find((row) => row.venueId === venueId && row.category === "gin"
  && row.standing === "listed" && row.sourceUrl === sourceUrl && row.priceGbp === 10);

// Real committed menu evidence, streamed OSM identity and production GETs.
// Only the external basemap is deterministic. No price or HTML response is supplied.
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`streamed pub prices at ${viewport.width}px`, () => {
    test.use({ viewport, reducedMotion: "reduce", serviceWorkers: "block", storageState: { cookies: [], origins: [] } });

    test("List view retains an owned Gin quote with its unknown serving and source day", async ({ page }, info) => {
      test.setTimeout(90_000);
      expect(quote, "The current publisher fixture must exist").toBeDefined();
      expect(quote!.observedAt).toBe("2026-09-21T18:49:35.031Z");
      expect(quote!.servingSize?.trim() || null).toBeNull();
      const index = await page.request.get("/api/price-submit?drinkCategory=gin");
      expect(index.status()).toBe(200);
      const body = await index.json() as { listedPrices: PublishedQuote[]; degraded?: boolean; truncated: boolean };
      expect(body.degraded).not.toBe(true);
      expect(body.truncated).toBe(false);
      expect(body.listedPrices).toContainEqual(expect.objectContaining({
        venueId, category: "gin", priceGbp: 10, sourceUrl,
        observedAt: quote!.observedAt, servingSize: null,
      }));

      await installDeterministicMapBasemap(page);
      const response = await page.goto(`/map?drink=gin&sel=${venueId}&at=51.5303,-0.12478&list=1`);
      expect(response?.status()).toBe(200);
      await dismissMapIntroductions(page);
      await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("[data-map-canvas='ready']")).toBeVisible({ timeout: 30_000 });
      const detail = page.getByRole("button", { name: "Close venue detail", exact: true });
      await expect(detail).toBeVisible({ timeout: 30_000 });
      await expect(async () => {
        if (await detail.isVisible()) await detail.click();
        await expect(detail).not.toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      await dismissMapIntroductions(page);
      if (!(await page.locator(".mapVenueList--open").isVisible())) {
        if (viewport.width < 768) {
          await page.getByRole("button", { name: "More map controls", exact: true }).click();
          await page.getByRole("tab", { name: "Layers", exact: true }).click();
          await page.getByRole("button", { name: "List view of venues on the map", exact: true }).click();
        } else {
          await page.getByRole("button", { name: /Map layers:/ }).click();
          await page.getByRole("dialog", { name: "Map layers", exact: true })
            .getByRole("button", { name: /^List view(?: \d+)?$/ }).click();
        }
      }
      await expect(page.locator(".mapVenueList--open")).toBeVisible();
      const row = page.locator(`.mapVenueListItem[data-venue-id="${venueId}"]`);
      const next = page.getByRole("navigation", { name: "Venue list pages", exact: true })
        .getByRole("button", { name: "Next", exact: true });
      while (await row.count() === 0 && await next.isEnabled()) {
        const first = await page.locator(".mapVenueListItem").first().getAttribute("data-venue-id");
        await next.click();
        await expect(page.locator(".mapVenueListItem").first()).not.toHaveAttribute("data-venue-id", first!);
      }
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row.locator(".mapVenueListCompactPrice > span").first()).toHaveText("Gin · £10.00");
      await expect(row.locator(".mapVenueListPriceProvenance"))
        .toHaveText("Serving not recorded · www.thebetjemanarms.co.uk · 21 Sept 2026 · Unranked");
      await expect(row).not.toContainText("Other pub · no listed price");
      await expect(row).not.toContainText("25ml");
      await info.attach(`streamed-pub-owned-gin-${viewport.width}`, {
        contentType: "image/png", body: await page.screenshot(),
      });
    });
  });
}
