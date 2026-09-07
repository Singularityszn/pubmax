import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  PRICE_CHIP_PHONE_COLUMNS,
  PRICE_CHIP_WIDE_COLUMNS,
  priceChipColumns,
} from "@/lib/priceChipLadder";

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
              !/memoryKeepRow__select|memoryKeepRemove|memoryKeepConfirm|memoryStoryList__select|profileImage|coverPhoto/.test(
                className,
              ),
          ),
      );
    expect(strays).toEqual([]);

    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await hub.screenshot({ path: `${PROOF}/after-profile-editor-${viewport.name}.png` });
  });

  test(`${viewport.name}px: the planner and /pubs number squares are one chip`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await quietPage(page);

    await page.goto("/plan", { waitUntil: "domcontentloaded" });
    const plannerChips = page.locator(".planStopCount__choices .uiChip--number");
    await expect(plannerChips.first()).toBeVisible({ timeout: 30_000 });
    const plannerBoxes = await controlBoxes(plannerChips);
    expect(plannerBoxes.length).toBeGreaterThan(1);
    await page
      .locator(".planStopCount")
      .first()
      .screenshot({ path: `${PROOF}/after-plan-stop-count-${viewport.name}.png` });

    await page.goto("/pubs?zone=1", { waitUntil: "domcontentloaded" });
    const zoneChips = page.locator(".pubsZoneChips .uiChip--number");
    await expect(zoneChips.first()).toBeVisible({ timeout: 30_000 });
    const zoneBoxes = await controlBoxes(zoneChips);
    expect(zoneBoxes.length).toBeGreaterThan(1);
    await page
      .locator(".pubsZoneChips")
      .first()
      .screenshot({ path: `${PROOF}/after-pubs-zone-chips-${viewport.name}.png` });

    // ONE SELECTOR reaches both rows, and both rows measure the same square.
    for (const box of [...plannerBoxes, ...zoneBoxes]) {
      expect(box.radius).toBe(plannerBoxes[0]!.radius);
      expect(box.weight).toBe(plannerBoxes[0]!.weight);
      expect(box.fontSize).toBe(plannerBoxes[0]!.fontSize);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(plannerBoxes[0]!.radius).toBe("14px");

    // The chosen square carries its state on aria-pressed, on both surfaces.
    await expect(page.locator('.pubsZoneChips .uiChip--number[aria-pressed="true"]')).toHaveCount(1);
  });
}

test("390px: the five quick price chips wrap four and one, aligned to the first column", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 844 });
  await quietPage(page);
  await installDeterministicMapBasemap(page);

  const response = await page.goto("/map?log=1");
  expect(response?.status()).toBe(200);

  const nearby = page.locator(".logIntentNearbyBtn").first();
  await expect(nearby).toBeVisible({ timeout: 45_000 });
  const priceStep = page.getByTestId("spill-price-step");
  // A control painted on the server is tappable before React attaches, so the
  // tap is retried rather than the assertion after it made harder.
  await expect(async () => {
    await nearby.click();
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

  const columns = priceChipColumns(390);
  expect(columns).toBe(PRICE_CHIP_PHONE_COLUMNS);
  // Four across, and the fifth chip STARTS the second row rather than landing
  // wherever the fourth left off.
  expect(rows[0]!.length).toBe(4);
  expect(rows.length).toBeGreaterThan(1);
  expect(rows[1]![0]!.left).toBe(rows[0]![0]!.left);
  // Nothing squeezed: every chip keeps the tap target the row promised.
  for (const box of layout) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  // The row never scrolls sideways.
  const overflow = await priceStep.evaluate((step) => {
    const row = step.querySelector(".priceQuickAdds") as HTMLElement | null;
    return row ? row.scrollWidth - row.clientWidth : 0;
  });
  expect(overflow).toBeLessThanOrEqual(1);

  await priceStep.screenshot({ path: `${PROOF}/after-price-chips-390.png` });
});

test("1280px: the same ladder stands the quick price chips five across", async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  await quietPage(page);
  await installDeterministicMapBasemap(page);

  const response = await page.goto("/map?log=1");
  expect(response?.status()).toBe(200);

  const nearby = page.locator(".logIntentNearbyBtn").first();
  await expect(nearby).toBeVisible({ timeout: 45_000 });
  const priceStep = page.getByTestId("spill-price-step");
  await expect(async () => {
    await nearby.click();
    await expect(priceStep).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 25_000 });

  const chips = priceStep.locator(".priceQuickAdds .priceChip");
  await expect(chips.first()).toBeVisible({ timeout: 15_000 });
  const tops = await chips.evaluateAll((elements) =>
    elements.map((element) => Math.round(element.getBoundingClientRect().top)),
  );
  const firstRow = tops.filter((top) => Math.abs(top - tops[0]!) <= 2).length;
  expect(priceChipColumns(1280)).toBe(PRICE_CHIP_WIDE_COLUMNS);
  expect(firstRow).toBe(Math.min(tops.length, PRICE_CHIP_WIDE_COLUMNS));

  await priceStep.screenshot({ path: `${PROOF}/after-price-chips-1280.png` });
});
