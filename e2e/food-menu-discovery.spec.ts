import { expect, test, type Locator } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";
import { beginPublicEvidence } from "./helpers/publicPageEvidence";

if (process.env.PUBMAX_PUBLIC_EVIDENCE_PHASE) {
  test.use({ trace: "off", video: "off" });
}

async function expectDietaryEvidenceLayout(dietary: Locator) {
  const layout = await dietary.evaluate((element) => {
    const label = element.querySelector("span");
    const source = element.querySelector(".drinkProvChip");
    const date = element.querySelector(".drinkObservationAge");
    if (!label || !source || !date) return null;
    const labelBox = label.getBoundingClientRect();
    const sourceBox = source.getBoundingClientRect();
    const dateBox = date.getBoundingClientRect();
    const container = element.getBoundingClientRect();
    return {
      sourceFragments: source.getClientRects().length,
      labelBottom: labelBox.bottom,
      sourceTop: sourceBox.top,
      sourceBottom: sourceBox.bottom,
      sourceRight: sourceBox.right,
      dateTop: dateBox.top,
      dateRight: dateBox.right,
      containerRight: container.right,
    };
  });
  expect(layout).not.toBeNull();
  expect(layout!.sourceFragments).toBe(1);
  expect(layout!.sourceTop).toBeGreaterThanOrEqual(layout!.labelBottom);
  expect(layout!.dateTop).toBeGreaterThanOrEqual(layout!.sourceBottom);
  expect(layout!.sourceRight).toBeLessThanOrEqual(layout!.containerRight);
  expect(layout!.dateRight).toBeLessThanOrEqual(layout!.containerRight);
}

for (const width of [390, 1440]) {
  for (const door of ["food", "all", "beer"]) {
    test(`${width}px: ${door} menu drill-in preserves arrow-key tab ownership on revisit`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => {
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      await installDeterministicMapBasemap(page);
      await page.goto("/map?sel=venue-1hz0avt");
      const menu = page.getByRole("tab", { name: "Menu", exact: true });
      await expect(async () => {
        await menu.click();
        await expect(menu).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
      }).toPass({ timeout: 45_000 });
      const panel = page.locator("#venuePanel-menu");
      const entry = panel.locator(`[data-menu-door="${door}"]`);
      for (let round = 0; round < 2; round += 1) {
        await entry.click();
        const back = panel.locator(".drinkMenuBack");
        await expect(back).toBeFocused();
        const photos = page.getByRole("tab", { name: "Photos", exact: true });
        await photos.click();
        await photos.press("ArrowRight");
        await expect(menu).toBeFocused();
        for (const [key, labels] of [
          ["ArrowRight", ["Prices", "Lore", "Overview", "Photos", "Menu"]],
          ["ArrowLeft", ["Photos", "Overview", "Lore", "Prices", "Menu"]],
        ] as const) {
          for (const label of labels) {
            await page.keyboard.press(key);
            const selected = page.getByRole("tab", { name: label, exact: true });
            await expect(selected).toBeFocused();
            await expect(selected).toHaveAttribute("aria-selected", "true");
          }
        }
        await back.click();
        await expect(entry).toBeFocused();
      }
    });
  }
}

for (const width of [320, 390, 430, 1440]) {
  test(`${width}px: the recorded Food menu is reachable and returns to its own button`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await installDeterministicMapBasemap(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/map?sel=venue-1hz0avt");
    const menuTab = page.getByRole("tab", { name: "Menu", exact: true });
    await expect(menuTab).toBeVisible({ timeout: 45_000 });
    await expect(async () => {
      await menuTab.click();
      await expect(menuTab).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    const panel = page.locator("#venuePanel-menu");
    const food = panel.getByRole("button", { name: "Food 42 dishes on record", exact: true });
    const drinks = panel.getByRole("button", { name: "Drinks 23 on record", exact: true });
    await expect(food).toBeVisible();
    await expect(drinks).toBeVisible();
    await drinks.focus();
    await page.keyboard.press("Tab");
    await expect(food).toBeFocused();
    await food.click();
    const back = panel.getByRole("button", { name: "Back to menus", exact: true });
    await expect(back).toBeFocused();
    await expect(panel.locator(".drinkRow")).toHaveCount(42);
    await expect(panel.locator(".foodCalories")).toHaveCount(42);
    const firstCalories = panel.locator(".foodCalories").first();
    await expect(firstCalories).toContainText(/\d+ kcal on the menu/);
    const firstRow = panel.locator(".drinkRow").first();
    if (width <= 640) {
      const rowWidth = (await firstRow.boundingBox())!.width;
      const nameWidth = (await firstRow.locator(".drinkName").boundingBox())!.width;
      expect(nameWidth).toBeGreaterThanOrEqual(rowWidth * 0.6);
    }
    await expect(firstRow.locator("a")).toHaveCount(1);
    await expect(firstRow.locator("a")).toHaveAttribute("href", "https://www.theeaglew12.co.uk/food-drink");
    await expect(firstRow.locator("time")).toContainText("13 October 2026");
    await expect(firstRow.locator(".drinkRowSide")).toContainText("Price and calories");
    await back.click();
    await expect(food).toBeFocused();
    await expect(panel.locator(".drinkRow")).toHaveCount(0);
    const geometry = await food.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const centre = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { x: box.x, right: box.right, width: box.width, height: box.height, ownsCentre: element.contains(centre) };
    });
    expect(geometry.x).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.ownsCentre).toBe(true);
    expect(errors).toEqual([]);
  });
}

for (const menu of [
  { venueId: "venue-17qpap6", count: 27, width: 390, dish: "Padron Peppers", price: "£5.50", calories: 104, source: "https://www.newinnealing.com/food-and-drink", publisher: "The New Inn - official published menu", observedAt: "2026-10-13T09:43:11.443Z" },
  { venueId: "venue-1dafrop", count: 21, width: 1440, dish: "Sun dried tomato salad", price: "£18.00", calories: 910, source: "https://www.thenarrowboatpub.com/food-and-drink", publisher: "The Narrowboat - official published menu", observedAt: "2026-10-13T09:43:11.553Z" },
]) {
  test(`${menu.venueId}: reviewed food facts retain publisher dietary evidence`, async ({ page }) => {
    await page.setViewportSize({ width: menu.width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await installDeterministicMapBasemap(page);
    await page.goto(`/map?sel=${menu.venueId}`);
    const tab = page.getByRole("tab", { name: "Menu", exact: true });
    await expect(async () => {
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    const panel = page.locator("#venuePanel-menu");
    const food = panel.getByRole("button", { name: `Food ${menu.count} dishes on record`, exact: true });
    await food.click();
    await expect(panel.locator(".drinkRow")).toHaveCount(menu.count);
    const row = panel.locator(".drinkRow").filter({ has: page.getByText(menu.dish, { exact: true }) });
    await expect(row.locator(".drinkPrice")).toHaveText(menu.price);
    const dietary = row.locator(".drinkServing");
    await expect(dietary).toContainText("vegan");
    await expect(dietary.getByRole("link", { name: menu.publisher, exact: true })).toHaveAttribute("href", menu.source);
    await expect(dietary.locator("time")).toHaveAttribute("datetime", menu.observedAt);
    await expect(dietary.locator("time")).toHaveText("13 October 2026");
    await expectDietaryEvidenceLayout(dietary);
    await expect(row.locator(".foodCalories")).toContainText(`${menu.calories} kcal on the menu`);
    const price = row.locator(".drinkRowSide");
    await expect(price.getByRole("link", { name: menu.publisher, exact: true })).toHaveAttribute("href", menu.source);
    await expect(price.locator("time")).toHaveAttribute("datetime", menu.observedAt);
    await expect(price.locator("time")).toHaveText("13 October 2026");
    await panel.getByRole("button", { name: "Back to menus", exact: true }).click();
    await expect(food).toBeFocused();
  });
}

test.describe("public screenshot evidence", () => {
  test.skip(!process.env.PUBMAX_PUBLIC_EVIDENCE_PHASE, "Requires the separate immutable source checkout");

  test("records the New Inn dietary publisher beside its menu label", async ({ page }, testInfo) => {
    test.setTimeout(270_000);
    const evidence = await beginPublicEvidence(page, testInfo, "food-menu-discovery");
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ] as const) {
      await page.setViewportSize(viewport);
      const response = await page.goto("/map?sel=venue-17qpap6");
      expect(response).not.toBeNull();
      expect(response!.status()).toBe(200);
      const menu = page.getByRole("tab", { name: "Menu", exact: true });
      await expect(async () => {
        await menu.click();
        await expect(menu).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
      }).toPass({ timeout: 45_000 });
      const panel = page.locator("#venuePanel-menu");
      const food = panel.getByRole("button", { name: "Food 27 dishes on record", exact: true });
      await food.click();
      await expect(panel.getByRole("button", { name: "Back to menus", exact: true })).toBeFocused();
      await expect(panel.locator(".drinkRow")).toHaveCount(27);
      const row = panel.locator(".drinkRow").filter({ has: page.getByText("Padron Peppers", { exact: true }) });
      await row.scrollIntoViewIfNeeded();
      await expect(row).toBeVisible();
      await expect(row.locator(".drinkPrice")).toHaveText("£5.50");
      await expect(row.locator(".foodCalories")).toContainText("104 kcal on the menu");
      const price = row.locator(".drinkRowSide");
      await expect(price).toContainText("Price and calories");
      await expect(price.getByRole("link", { name: "The New Inn - official published menu", exact: true })).toHaveAttribute("href", "https://www.newinnealing.com/food-and-drink");
      await expect(price.locator("time")).toHaveAttribute("datetime", "2026-10-13T09:43:11.443Z");
      const dietary = row.locator(".drinkServing");
      if (evidence.phase === "after") {
        await expect(dietary).toContainText("vegan");
        await expect(dietary.getByRole("link", { name: "The New Inn - official published menu", exact: true })).toHaveAttribute("href", "https://www.newinnealing.com/food-and-drink");
        await expect(dietary.locator("time")).toHaveAttribute("datetime", "2026-10-13T09:43:11.443Z");
        await expect(dietary.locator("time")).toHaveText("13 October 2026");
        await expectDietaryEvidenceLayout(dietary);
      } else {
        await expect(dietary).toHaveText("vegan");
        await expect(dietary.locator("a, time")).toHaveCount(0);
      }
      await expectMapLoadingFrameReleased(page);
      const bounds = await row.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      await evidence.capture(`page-${viewport.width}.png`, response!);
    }
    await evidence.finish();
  });
});
