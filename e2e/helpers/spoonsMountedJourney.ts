import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

import { installAuthDoubles } from "./authDoubles";
import { installDeterministicMapBasemap } from "./mapNetworkFixtures";
import { expectMobileMapShellReady } from "./mobileMapShell";

const LUCIA_MAP_SUBTYPE = "soft-drink-lucia-special";

export function drinkSheet(page: Page): Locator {
  return page.locator('.mobileSheetPortal[data-sheet-kind="drink"]');
}

async function openDrink(page: Page): Promise<Locator> {
  await expectMobileMapShellReady(page);
  const chip = page.locator(".mobileMapChipRow").getByRole("button", { name: /Drink shown on the map/ });
  await chip.tap();
  const sheet = drinkSheet(page);
  await expect(sheet).toBeVisible();
  return sheet;
}

async function closeDrink(page: Page): Promise<void> {
  await drinkSheet(page).getByRole("button", { name: "Close Drink", exact: true }).tap();
  await expect(drinkSheet(page)).toHaveCount(0);
}

/** Only the initial bootstrap loads a document. Every product destination is tapped. */
export async function enterMountedSoftDrinks(page: Page): Promise<number> {
  const auth = await installAuthDoubles(page);
  await installDeterministicMapBasemap(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.goto("/privacy");
  await auth.signedInAs(null);
  await expect(page.getByRole("button", { name: /Switch to .* theme/ }).first()).toBeEnabled();
  const documentStartedAt = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole("navigation", { name: "Primary", exact: true })
    .getByRole("link", { name: "Explore", exact: true }).tap();
  await expect(page).toHaveURL(/\/map$/);
  await expect.poll(() => page.evaluate(() => performance.timeOrigin)).toBe(documentStartedAt);
  const sheet = await openDrink(page);
  await sheet.getByRole("button", { name: "Soft drinks", exact: true }).tap();
  await expect(sheet.getByRole("button", { name: "Soft drinks", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => new URL(page.url()).searchParams.get("drink")).toBe("soft-drink");
  await closeDrink(page);
  const reopened = await openDrink(page);
  await expect(reopened.getByRole("button", { name: "Soft drinks", exact: true })).toHaveAttribute("aria-pressed", "true");
  await reopened.getByRole("button", { name: "Spoons value", exact: true }).tap();
  await expect(reopened.locator(".spoonsValueLensLegend")).toBeVisible();
  return documentStartedAt;
}

export async function lowerContentGeometry(page: Page) {
  return drinkSheet(page).locator(".mobileSharedSheetBody").evaluate((body) => {
    const lower = body.querySelector(".spoonsValueLensNote");
    if (!lower) throw new Error("The enabled legend has no lower explanation");
    const frame = body.getBoundingClientRect();
    const box = lower.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      scrollTop: body.scrollTop, overflow: body.scrollHeight - body.clientHeight,
      bodyTop: frame.top, bodyBottom: frame.bottom, lowerTop: box.top, lowerBottom: box.bottom,
      lowerFullyReachable: box.top >= frame.top && box.bottom <= frame.bottom && Boolean(hit && lower.contains(hit)),
      documentScrollY: window.scrollY,
    };
  });
}

export async function clickLuciaAndReturn(page: Page, documentStartedAt: number, testInfo: TestInfo): Promise<void> {
  await closeDrink(page);
  const reopened = await openDrink(page);
  await expect(reopened.getByRole("button", { name: "Spoons value", exact: true })).toHaveAttribute("aria-pressed", "true");
  await reopened.getByRole("link", { name: /Lucia 🐐/ }).tap();
  await expect(page).toHaveURL(/\/soft-drinks-and-water\?sub=soft-drink-lucia-special$/);
  await expect(page.getByRole("tab", { name: "Lucia 🐐", exact: true })).toHaveAttribute("aria-selected", "true");
  // Independent oracle: the committed Wells menu observation in uk_prices/rows.json,
  // not the production subtype selector or the displayed row read back as its own expectation.
  const wells = page.locator(".softDrinksWater__row").filter({
    has: page.locator('a[href="/ledger/venue-1472h4h"]'),
  });
  await expect(wells).toHaveCount(1);
  await expect(wells.locator(".softDrinksWater__price")).toHaveText("£3.65");
  await expect(wells).toContainText("Collected 17 October 2026");
  await expect(wells.getByRole("link", { name: "thewellshampstead.co.uk", exact: true })).toHaveAttribute(
    "href", "https://thewellshampstead.co.uk/wp-content/uploads/2026/02/Wine-List-Spring-docx.pdf",
  );
  await wells.scrollIntoViewIfNeeded();
  await expect(wells.locator(".softDrinksWater__price")).toBeVisible();
  await wells.screenshot({ path: testInfo.outputPath("lucia-listed-price-source-date.png") });
  await page.getByRole("link", { name: "Open the map", exact: true }).tap();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/map");
  await expect.poll(() => new URL(page.url()).searchParams.get("drink")).toBe("soft-drink");
  await expect.poll(() => new URL(page.url()).searchParams.get("sub")).toBe(LUCIA_MAP_SUBTYPE);
  await expectMobileMapShellReady(page);
  await expect.poll(() => page.evaluate(() => performance.timeOrigin)).toBe(documentStartedAt);
  const returned = await openDrink(page);
  await expect(returned.getByRole("button", { name: "Soft drinks", exact: true })).toHaveAttribute("aria-pressed", "true");
}

export async function clickRankingAndCheckRecordedCosts(page: Page, documentStartedAt: number, testInfo: TestInfo): Promise<void> {
  await drinkSheet(page).getByRole("link", { name: "See the ranking", exact: true }).tap();
  await expect(page).toHaveURL(/\/spoons-value$/);
  // The phone dock keeps its six doors: Spoons is a desktop link only, so the
  // ranking is reached through the Drink sheet, never a dock tab.
  const nav = page.getByRole("navigation", { name: "Primary", exact: true });
  await expect(nav.getByRole("link", { name: "Spoons", exact: true })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Find a Spoons" }).fill("Teignmouth");
  const row = page.locator(".spoonsTable tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("The Jolie Brise");
  await expect(row).toContainText("£9.96");
  await row.locator("summary").tap();
  await expect(row).toContainText("£8.97 total");
  await expect(row).toContainText("£0.99 total");
  await expect(row).toContainText("Source read 2026-08-30");
  await expect(page.getByRole("link", { name: /SpoonMe/ }).first()).toHaveAttribute("href", /^https:\/\//);
  await row.screenshot({ path: testInfo.outputPath("spoons-recorded-cost-source-date.png") });
  // Return through Explore, the Drink chip and "See the ranking", as a phone reader does.
  await nav.getByRole("link", { name: "Explore", exact: true }).tap();
  await expectMobileMapShellReady(page);
  const again = await openDrink(page);
  await again.getByRole("link", { name: "See the ranking", exact: true }).tap();
  await expect(page).toHaveURL(/\/spoons-value$/);
  await expect(page.getByRole("searchbox", { name: "Find a Spoons" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => performance.timeOrigin)).toBe(documentStartedAt);
}
