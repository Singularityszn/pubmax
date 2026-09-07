import { test, expect, type Page } from "@playwright/test";

/**
 * PlanAstra item 9 — the map's chrome overload at 768 and 1440.
 *
 * The five venue-type chips floated over the map as a permanent band at every
 * width from 641px up, so a tablet met 20 to 24 controls before it had tapped
 * a pin. They live behind ONE Filters control now. Below 641px nothing moved:
 * a phone still reads the same toggles in its Filters sheet.
 */

const DESKTOP = [
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

function seedDismissedChrome(page: Page): Promise<void> {
  return page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

async function openMap(page: Page): Promise<void> {
  const response = await page.goto("/map", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mapToolbar")).toBeVisible({ timeout: 30_000 });
}

for (const viewport of DESKTOP) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.beforeEach(async ({ page }) => {
      await seedDismissedChrome(page);
      await page.setViewportSize(viewport);
    });

    test("keeps the five kind chips out of the head and inside the Filters popover", async ({
      page,
    }) => {
      await openMap(page);

      // Nothing of theirs is on the map, or anywhere else, until it is asked for.
      await expect(page.getByRole("group", { name: "Venue types" })).toHaveCount(0);
      await expect(page.locator(".tonightArcChip")).toHaveCount(0);

      const filters = page.locator(".mapToolbar .mapVenueKindFilterBtn");
      await expect(filters).toBeVisible();
      await expect(filters).toHaveAttribute("aria-expanded", "false");
      // Head row order: the search row leads, then Filters.
      const order = await page.evaluate(() => {
        const row = document.querySelector<HTMLElement>(".mapToolbarRow")!;
        const search = row.querySelector<HTMLElement>(".mapToolbarSearch");
        const filter = row.querySelector<HTMLElement>(".mapVenueKindFilter")!;
        const children = [...row.children];
        return {
          search: search ? children.indexOf(search) : -1,
          filter: children.indexOf(filter),
        };
      });
      expect(order.filter).toBeGreaterThan(order.search);

      // A tap opens the panel with the same five chips in it.
      await expect(async () => {
        await filters.click();
        await expect(
          page.locator(".mapVenueKindFilterPanel .tonightArcChip"),
        ).toHaveCount(5, { timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
      await expect(filters).toHaveAttribute("aria-expanded", "true");
      const panelId = await filters.getAttribute("aria-controls");
      expect(panelId).toBeTruthy();
      await expect(page.locator(`#${panelId}`)).toBeVisible();
    });

    test("counts the kinds switched off on the closed control, and keeps the state", async ({
      page,
    }) => {
      await openMap(page);
      const filters = page.locator(".mapToolbar .mapVenueKindFilterBtn");
      await expect(async () => {
        await filters.click();
        await expect(
          page.getByRole("button", { name: "Bars", exact: true }),
        ).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 30_000 });

      await expect(filters).toHaveText("Filters");
      await page.getByRole("button", { name: "Bars", exact: true }).click();
      await expect(filters).toHaveText(/Filters · 1/);
      await page.getByRole("button", { name: "Restaurants", exact: true }).click();
      await expect(filters).toHaveText(/Filters · 2/);
      await expect(filters).toHaveAttribute(
        "aria-label",
        "Filters: venue types, 2 types hidden",
      );

      // Closing and reopening reads the same state back: the popover is a view
      // of the map's own filter, never a second copy of it.
      await page.keyboard.press("Escape");
      await expect(filters).toHaveAttribute("aria-expanded", "false");
      await expect(filters).toHaveText(/Filters · 2/);
      await filters.click();
      await expect(
        page.getByRole("button", { name: "Bars", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await expect(
        page.getByRole("button", { name: "Pints", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");

      // One reset, and it names what it resets.
      await page.getByRole("button", { name: "Show all types" }).click();
      await expect(filters).toHaveText("Filters");
    });

    test("closes on Escape and hands focus back to the control", async ({
      page,
    }) => {
      await openMap(page);
      const filters = page.locator(".mapToolbar .mapVenueKindFilterBtn");
      await expect(async () => {
        await filters.click();
        await expect(
          page.locator(".mapVenueKindFilterPanel"),
        ).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 30_000 });

      await page.keyboard.press("Escape");
      await expect(page.locator(".mapVenueKindFilterPanel")).toHaveCount(0);
      await expect(filters).toBeFocused();

      // The keyboard opens it too, and the venue drawer stays out of it.
      await page.keyboard.press("Enter");
      await expect(page.locator(".mapVenueKindFilterPanel")).toBeVisible();
    });
  });
}

test.describe("390x844", () => {
  test("leaves the phone exactly as it was: chips in the Filters sheet", async ({
    page,
  }) => {
    await seedDismissedChrome(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openMap(page);

    // The desktop control never reaches a phone.
    await expect(page.locator(".mapVenueKindFilterBtn")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Venue types" })).toHaveCount(0);

    await expect(async () => {
      await page
        .locator(".mobileMapTopbar")
        .getByRole("button", { name: /^Filters/ })
        .click();
      await expect(
        page
          .locator('.mobileSheetPortal[data-sheet-kind="filters"]')
          .getByRole("group", { name: "Venue types" }),
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 45_000 });

    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
    await expect(sheet.locator(".tonightArcChip")).toHaveCount(5);
    await expect(sheet.locator(".tonightArcChipsSheet")).toBeVisible();
  });
});
