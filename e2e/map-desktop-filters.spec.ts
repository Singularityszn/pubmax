import { test, expect, type Page } from "@playwright/test";

/**
 * PlanAstra item 9, over the map's chrome overload at 768 and 1440.
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

/**
 * A phone has no `.mapToolbar` at all: the desktop toolbar is the surface this
 * lane changed, and the phone reads its own top bar. Waiting for the wrong one
 * is a 30 second timeout that reads like a missing control.
 */
async function openMap(page: Page, phone = false): Promise<void> {
  const response = await page.goto("/map", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(
    page.locator(phone ? ".mobileMapTopbar" : ".mapToolbar"),
  ).toBeVisible({ timeout: 60_000 });
}

for (const viewport of DESKTOP) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    // A cold production map plus a retried first tap outruns the 30s default.
    test.describe.configure({ timeout: 120_000 });

    test.beforeEach(async ({ page }) => {
      await seedDismissedChrome(page);
      await page.setViewportSize(viewport);
    });

    test("keeps the four kind chips out of the head and inside the Filters popover", async ({
      page,
    }) => {
      await openMap(page);

      // Nothing of theirs is on the map, or anywhere else, until it is asked for.
      await expect(page.getByRole("group", { name: "Venue types" })).toHaveCount(0);
      await expect(page.locator(".tonightArcChip")).toHaveCount(0);

      const filters = page.locator(".mapToolbar .mapVenueKindFilterBtn");
      await expect(filters).toBeVisible();
      await expect(filters).toHaveAttribute("aria-expanded", "false");
      // The panel holds three questions now, not one: the venue types, the
      // experience lens and the fare zones all moved in behind this control
      // (7 Sep 2026, walk finding B9), so the accessible name says all three.
      await expect(filters).toHaveAttribute(
        "aria-label",
        "Filters: venue types, view and zone",
      );
      // The word shows where the toolbar row can afford it: from 641 to 900px
      // the search field is what a longer label would cost.
      const word = filters.locator(".mapVenueKindFilterWord");
      if (viewport.width > 900) {
        await expect(word).toBeVisible();
      } else {
        await expect(word).toBeHidden();
      }
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

      // The toolbar's search field is a lazy chunk, so it can arrive after the
      // toolbar does. Wait for it rather than measuring an absent box.
      await expect(page.locator(".mapToolbar .mapToolbarSearch input")).toBeVisible({
        timeout: 30_000,
      });

      // Rendered geometry, not source order: a control the row squeezes to
      // nothing overlaps the search field beside it, and no source fence sees
      // that. The two boxes may not intersect.
      const boxes = await page.evaluate(() => {
        const rect = (selector: string) =>
          document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
        // The INPUT, not its cell: a flex item cannot shrink past its own
        // min-width, so the field overflowed the cell the row gave it and its
        // text ran under the control beside it while both cells still measured
        // as neighbours.
        const input = rect(".mapToolbar .mapToolbarSearch input");
        const filter = rect(".mapToolbar .mapVenueKindFilterBtn");
        return input && filter
          ? {
              inputRight: input.right,
              inputWidth: input.width,
              filterLeft: filter.left,
              filterWidth: filter.width,
              filterHeight: filter.height,
            }
          : null;
      });
      expect(boxes, "search and Filters both rendered").not.toBeNull();
      expect(boxes!.filterLeft).toBeGreaterThanOrEqual(boxes!.inputRight - 0.5);
      // A control a thumb has to hit is 44px in both directions, and dropping
      // the word under 900px leaves the icon and the count measuring 37px.
      expect(boxes!.filterWidth).toBeGreaterThanOrEqual(44);
      expect(boxes!.filterHeight).toBeGreaterThanOrEqual(44);
      // A field narrower than this reads a postcode and nothing else.
      expect(boxes!.inputWidth).toBeGreaterThan(120);

      // A tap opens the panel with the same four chips in it. Four, not five:
      // `Clubs` is deleted (walk finding B9), because it could never have been
      // enabled. Clubs show with `Bars`: `curatedVenueKind` in
      // lib/venueKindFilters.ts files a club under the bars.
      await expect(async () => {
        await filters.click();
        await expect(
          page.locator(".mapVenueKindFilterPanel .tonightArcChip"),
        ).toHaveCount(4, { timeout: 2_000 });
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

      // The count is the half that survives the 641 to 900px toolbar budget,
      // so it is what these assertions read at both widths.
      const count = filters.locator(".mapVenueKindFilterCount");
      await expect(count).toHaveCount(0);
      await page.getByRole("button", { name: "Bars", exact: true }).click();
      await expect(count).toHaveText("1");
      await page.getByRole("button", { name: "Restaurants", exact: true }).click();
      await expect(count).toHaveText("2");
      // The count covers EVERY refinement the panel holds, kinds plus lens plus
      // zone, so a badge cannot say the map is unfiltered while two filters are
      // on (lib/venueKindFilters.ts, mapFilterRefinementCount).
      await expect(filters).toHaveAttribute(
        "aria-label",
        "Filters: venue types, view and zone, 2 filters on",
      );

      // Closing and reopening reads the same state back: the popover is a view
      // of the map's own filter, never a second copy of it.
      await page.keyboard.press("Escape");
      await expect(filters).toHaveAttribute("aria-expanded", "false");
      await expect(count).toHaveText("2");
      await filters.click();
      await expect(
        page.getByRole("button", { name: "Bars", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await expect(
        page.getByRole("button", { name: "Pints", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");

      // One reset, and it names what it resets.
      await page.getByRole("button", { name: "Show all types" }).click();
      await expect(count).toHaveCount(0);
      await expect(filters).toHaveAttribute(
        "aria-label",
        "Filters: venue types, view and zone",
      );
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
  test.describe.configure({ timeout: 120_000 });

  test("leaves the phone exactly as it was: chips in the Filters sheet", async ({
    page,
  }) => {
    await seedDismissedChrome(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openMap(page, true);

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
    // Four at both widths: `TonightArcChips` is one component read by the phone
    // sheet and the desktop popover alike, and `Clubs` is gone from both.
    await expect(sheet.locator(".tonightArcChip")).toHaveCount(4);
    await expect(sheet.locator(".tonightArcChipsSheet")).toBeVisible();
  });
});
