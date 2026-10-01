import { expect, test, type Page } from "@playwright/test";

import type { ShardManifest } from "../lib/slimShards";
import type { SlimVenue } from "../lib/venuesSlim";

const VIEWPORT = { width: 390, height: 844 };

test.use({
  serviceWorkers: "block",
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("no-alcohol and food views own the 390px map without pint controls", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = watchPageErrors(page);
  // Two unchanged publisher-priced food rows and one pub form the input.
  // Narrow the served core instead of deriving a count from whichever cells
  // arrive first. Prices below are GBP; every published source tuple stays.
  const fixtureIds = ["food-le-bab-soho", "food-wong-kei", "venue-lukeav"];
  await page.route("**/data/venues_slim.core.json*", async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const payload = await response.json() as { rows: SlimVenue[] };
    const fixtureRows = payload.rows.filter((row) => fixtureIds.includes(row.id));
    expect(fixtureRows).toHaveLength(3);
    expect(fixtureRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "food-le-bab-soho", name: "Le Bab Soho", kind: "food", cheapestPrice: 16.5,
        anchorLabel: "Lamb adana kebab", anchorObservedAt: "2026-07-26",
        anchorSourceUrl: "https://eatlebab.com/",
      }),
      expect.objectContaining({
        id: "food-wong-kei", name: "Wong Kei", kind: "food", cheapestPrice: 10.8,
        anchorLabel: "Roast duck on rice", anchorObservedAt: "2026-07-26",
        anchorSourceUrl: "https://wongkeilondon.com/",
      }),
      expect.objectContaining({ id: "venue-lukeav", name: "Bradley’s Spanish Bar", cheapestPrice: 6 }),
    ]));
    expect(fixtureRows.find((row) => row.id === "venue-lukeav")?.kind ?? "pub").toBe("pub");
    // Preserve the served revision/envelope and every chosen venue field.
    await route.fulfill({ response, json: { ...payload, rows: fixtureRows } });
  });
  await page.route("**/data/venues_slim.manifest.json*", async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const payload = await response.json() as ShardManifest;
    const core = payload.shards.find((shard) => shard.core && shard.url === "/data/venues_slim.core.json");
    expect(core).toBeDefined();
    await route.fulfill({
      response, json: { ...payload, shards: [{ ...core, count: fixtureIds.length }] },
    });
  });
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // The phone chrome mounts with the SCENE, not with the document, and warming
  // the map up regularly outlasts the 10s expect budget on a cold server. That
  // is a wait on the map, not a finding about this view, so it gets the same
  // generous first-paint budget every other mobile map spec takes.
  const filtersButton = page.getByRole("button", { name: /^Filters/ });
  await expect(filtersButton).toBeVisible({ timeout: 45_000 });
  await filtersButton.click();

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
  await expect(sheet).toBeVisible();
  const mapViewGroup = sheet.getByRole("group", { name: "Map view" });
  const all = mapViewGroup.getByRole("button", { name: "All", exact: true });
  const noAlcohol = mapViewGroup.getByRole("button", {
    name: "No alcohol",
    exact: true,
  });
  const food = mapViewGroup.getByRole("button", { name: "Food", exact: true });
  for (const control of [all, noAlcohol, food]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 390) + (box?.width ?? 1)).toBeLessThanOrEqual(390);
  }

  const indexResponse = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/api/price-submit?lens=no-alcohol") &&
      candidate.status() === 200,
  );
  await noAlcohol.click();
  await indexResponse;
  await expect(noAlcohol).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("status")).toContainText(
    /alcohol-free or soft drink prices/i,
  );
  await expect(
    sheet.getByRole("button", { name: "Beer", exact: true }),
  ).toHaveCount(0);
  await expect(sheet.getByText("Maximum pint price")).toHaveCount(0);
  await expect(filtersButton).toHaveAttribute(
    "aria-label",
    "Filters: no-alcohol view active",
  );

  await food.click();
  await expect(food).toHaveAttribute("aria-pressed", "true");
  // The fixture supplies two named publisher-priced food venues. The pub
  // must not count as a menu price; retain the exact positive count and copy.
  await expect(sheet.getByRole("status")).toHaveText(
    "2 menu prices we have shown.",
  );
  await expect(
    page.getByRole("button", { name: "Pints", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Bars", exact: true }),
  ).toHaveCount(0);
  await expect(
    sheet
      .getByRole("group", { name: "Venue types" })
      .getByRole("button", { name: "Food", exact: true }),
  ).toBeVisible();
  await expect(filtersButton).toHaveAttribute(
    "aria-label",
    "Filters: food view active",
  );

  expect(errors).toEqual([]);
});
