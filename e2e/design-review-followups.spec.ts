import { expect, test, type Locator, type Page } from "@playwright/test";

import { PRICE_CHIP_COLUMNS, PRICE_CHIP_MIN_COLUMN_PX } from "@/lib/priceChipLadder";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

/**
 * The three follow-ups the 6 September 2026 design review recorded and did not
 * take (docs/proof/design-review-fix-web/REPORT.md, and the rows it moved into
 * docs/design/BACKLOG.md):
 *
 *   1. the profile editor's own button family,
 *   2. one family for number-square chips,
 *   3. the five quick price chips wrapping 4 + 1 at 390 on a deliberate ladder.
 *
 * Each is measured here in a real browser at the two widths the review walked,
 * because each defect is a COMPUTED value: a radius, a weight, a row cut. The
 * source-level laws sit beside them in __tests__/buttonPrimitive.test.tsx,
 * __tests__/chipPrimitive.test.tsx and __tests__/priceChipLadder.test.ts.
 *
 * Proof shots land in docs/proof/design-review-followups/.
 */

const PROOF = "docs/proof/design-review-followups";
const WIDTHS = [
  { name: "390", width: 390, height: 844 },
  { name: "1280", width: 1280, height: 800 },
] as const;

type ControlBox = {
  height: number;
  radius: string;
  weight: string;
  fontSize: string;
};

async function controlBoxes(scope: Locator): Promise<ControlBox[]> {
  return scope.evaluateAll((elements) =>
    elements.map((element) => {
      const style = window.getComputedStyle(element);
      return {
        height: Math.round(element.getBoundingClientRect().height),
        radius: style.borderTopLeftRadius,
        weight: style.fontWeight,
        fontSize: style.fontSize,
      };
    }),
  );
}

/** A React re-render can detach the element between the wait and the shot. */
async function shoot(locator: Locator, path: string): Promise<void> {
  await expect(async () => {
    await locator.first().screenshot({ path });
  }).toPass({ timeout: 20_000 });
}

async function quietPage(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

for (const viewport of WIDTHS) {
  test(`${viewport.name}px: the profile editor's form buttons are the one button family`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await quietPage(page);
    await installAuthDoubles(page);
    await seedSignedIn(page, "A");

    await page.goto("/u/you", { waitUntil: "domcontentloaded" });

    const hub = page.locator(".accountHub");
    await expect(hub).toBeAttached({ timeout: 30_000 });
    // The Memory studio is the last block of the editor, so waiting for its
    // own form submit waits for the whole surface to be on the page.
    const createMemory = hub.getByRole("button", { name: "Create private Memory" });
    await expect(createMemory).toBeAttached({ timeout: 30_000 });

    // THE FAMILY. Every text button in the editor is the primitive, so it is
    // measured against the primitive rather than against a figure typed here.
    const primitives = hub.locator("button.uiButton");
    expect(await primitives.count()).toBeGreaterThan(5);
    const boxes = await controlBoxes(primitives);
    const reference = boxes[0];
    expect(reference).toBeDefined();
    for (const box of boxes) {
      expect(box.radius).toBe(reference!.radius);
      expect(box.weight).toBe(reference!.weight);
      expect(box.fontSize).toBe(reference!.fontSize);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // And that family is the product's, not the editor's own: the control row
    // is 14px corners at weight 700.
    expect(reference!.radius).toBe("14px");
    expect(reference!.weight).toBe("700");

    // The three form submits the backlog named, each one of that family.
    for (const name of ["Rename handle", "Save private details", "Create private Memory"]) {
      const control = hub.getByRole("button", { name, exact: true }).first();
      await expect(control).toHaveClass(/uiButton/);
    }

    // A refused control still reads as the same control: one disabled state.
    const disabledCount = await hub.locator("button.uiButton:disabled").count();
    if (disabledCount > 0) {
      const opacity = await hub
        .locator("button.uiButton:disabled")
        .first()
        .evaluate((element) => window.getComputedStyle(element).opacity);
      expect(Number(opacity)).toBeLessThan(1);
    }

    // Nothing in the editor paints a button of its own any more: every
    // remaining plain <button> is a ROW control (a list row a reader selects),
    // never a text button.
    const strays = await hub
      .locator("button:not(.uiButton)")
      .evaluateAll((elements) =>
        elements
          .map((element) => String(element.className))
          .filter(
            (className) =>
              // Row controls (a list row a reader selects) and the one
              // control that is a <button> for a member and a <Link> for
              // everyone else, which already reads the same --control-* row.
              !/memoryKeepRow__select|memoryKeepRemove|memoryKeepConfirm|memoryStoryList__select|profileImage|coverPhoto|findLot__follow/.test(
                className,
              ),
          ),
      );
    expect(strays).toEqual([]);

    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await shoot(hub, `${PROOF}/after-profile-editor-${viewport.name}.png`);
  });

  test(`${viewport.name}px: the planner and /pubs number squares are one chip`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await quietPage(page);

    // A box measured in the frame a row is still laying out is a smaller box,
    // not a smaller control, so each read is retried rather than made looser.
    async function settledBoxes(scope: Locator): Promise<ControlBox[]> {
      let settled: ControlBox[] = [];
      await expect(async () => {
        const boxes = await controlBoxes(scope);
        expect(boxes.length).toBeGreaterThan(1);
        for (const box of boxes) expect(box.height).toBeGreaterThanOrEqual(44);
        settled = boxes;
      }).toPass({ timeout: 15_000 });
      return settled;
    }

    await page.goto("/plan", { waitUntil: "domcontentloaded" });
    const plannerChips = page.locator(".planStopCount__choices .uiChip--number");
    await expect(plannerChips.first()).toBeVisible({ timeout: 30_000 });
    const plannerBoxes = await settledBoxes(plannerChips);
    await shoot(
      page.locator(".planStopCount"),
      `${PROOF}/after-plan-stop-count-${viewport.name}.png`,
    );

    await page.goto("/pubs?zone=1", { waitUntil: "domcontentloaded" });
    const zoneChips = page.locator(".pubsZoneChips .uiChip--number");
    await expect(zoneChips.first()).toBeVisible({ timeout: 30_000 });
    const zoneBoxes = await settledBoxes(zoneChips);
    await shoot(
      page.locator(".pubsZoneChips"),
      `${PROOF}/after-pubs-zone-chips-${viewport.name}.png`,
    );

    // ONE SELECTOR reaches both rows, and both rows measure the same square.
    const reference = plannerBoxes[0]!;
    for (const box of [...plannerBoxes, ...zoneBoxes]) {
      expect(box.radius).toBe(reference.radius);
      expect(box.weight).toBe(reference.weight);
      expect(box.fontSize).toBe(reference.fontSize);
    }
    expect(reference.radius).toBe("14px");

    // The chosen square carries its state on aria-pressed, on both surfaces.
    await expect(page.locator('.pubsZoneChips .uiChip--number[aria-pressed="true"]')).toHaveCount(1);
  });
}

for (const viewport of WIDTHS) {
  test(`${viewport.name}px: the five quick price chips wrap four and one, aligned to the first column`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await quietPage(page);
    await installDeterministicMapBasemap(page);

    const response = await page.goto("/map?log=1");
    expect(response?.status()).toBe(200);

    const nearby = page.locator(".logIntentNearbyBtn").first();
    await expect(nearby).toBeVisible({ timeout: 45_000 });
    const priceStep = page.getByTestId("spill-price-step");
    // The picker paints from the first shards and re-sorts when the ring load
    // brings nearer pubs. A re-sort between press and release lands the two on
    // different rows, and the browser sends no click. So a dropped tap is
    // retried. A tap that landed hides the picker, so it is never retried.
    await expect(async () => {
      if (await nearby.isVisible()) await nearby.click({ timeout: 2_000 });
      await expect(priceStep).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 25_000 });

    const chips = priceStep.locator(".priceQuickAdds .priceChip");
    await expect(chips.first()).toBeVisible({ timeout: 15_000 });

    const layout = await chips.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }),
    );
    expect(layout.length).toBeGreaterThanOrEqual(5);

    // The rows the ladder cut, read off the painted boxes.
    const rows: (typeof layout)[] = [];
    for (const box of layout) {
      const row = rows.at(-1);
      if (row && Math.abs(row[0]!.top - box.top) <= 2) row.push(box);
      else rows.push([box]);
    }

    // Four across at BOTH widths, and the fifth chip STARTS the second row
    // rather than landing wherever the fourth left off. The phone sheet's row
    // is 269px and the desktop drawer's 238px, so five across would squeeze
    // the desktop chips under the tap target.
    expect(rows[0]!.length).toBe(PRICE_CHIP_COLUMNS);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[1]![0]!.left).toBe(rows[0]![0]!.left);
    // Nothing squeezed: every chip keeps the tap target the row promised.
    for (const box of layout) {
      expect(box.height).toBeGreaterThanOrEqual(PRICE_CHIP_MIN_COLUMN_PX);
      expect(box.width).toBeGreaterThanOrEqual(PRICE_CHIP_MIN_COLUMN_PX);
    }
    // Every column is the same width, which is what a grid buys and a wrap did
    // not: on the old build the rows re-cut themselves per width.
    const widths = new Set(rows[0]!.map((box) => box.width));
    expect(widths.size).toBe(1);
    // The row never scrolls sideways.
    const overflow = await priceStep.evaluate((step) => {
      const row = step.querySelector(".priceQuickAdds") as HTMLElement | null;
      return row ? row.scrollWidth - row.clientWidth : 0;
    });
    expect(overflow).toBeLessThanOrEqual(1);

    await shoot(priceStep, `${PROOF}/after-price-chips-${viewport.name}.png`);
  });
}
