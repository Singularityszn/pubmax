import { expect, test, type Page } from "@playwright/test";

// The Plan result reads as a route. After "Sort it" the first thing on the page
// is a heading, ONE summary line, the stops as cards with the walk between
// them, and the settings behind "Tune details". There is no field to type a
// venue name into: a stop is a venue record, not a string.
//
// The generator is stubbed so the figures are known: three listed pubs, with
// their walking minutes and pint prices, exactly as /api/plans/generate sends
// them. Prices 5.60 + 5.20 + 6.60 = 17.40, walks 4 + 5 = 9.

const STOPS = [
  { venueId: "venue-xjf3n0", venueName: "Arnos Arms", walkingMinutesFromPrevious: null, estimatedPintPricePence: 560 },
  { venueId: "venue-1f5ygjb", venueName: "The Bohemia", walkingMinutesFromPrevious: 4, estimatedPintPricePence: 520 },
  { venueId: "venue-3h52h", venueName: "The Elephant Inn", walkingMinutesFromPrevious: 5, estimatedPintPricePence: 660 },
].map((stop, position) => ({
  ...stop,
  position,
  priceEvidence: { pence: stop.estimatedPintPricePence, source: { label: "Pub list", url: "https://example.com", observedAt: "2026-10-02" }, confidenceState: "fresh" },
  reason: "Close to the heart of the area.",
  alternatives: [],
}));

const GENERATED = {
  grounded: true,
  groundingProof: "stub-proof",
  operationKey: "stub-operation",
  inferredContext: {
    nightArea: "clapham", daypart: "evening", partyType: "friends", groupSize: 4, budget: "value",
    stopCount: 3, atmosphere: [], foodNeeds: [], accessibilityNeeds: [], zeroProof: false,
    drinkCategory: null, budgetLimitPence: null, transportConstraints: [], wetherspoonsPreferred: false,
  },
  stops: STOPS,
  alternatives: [],
};

async function sortARoute(page: Page): Promise<void> {
  await page.route("**/api/plans/generate", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(GENERATED) }),
  );
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  });
  await page.goto("/plan");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Describe the outing" }).fill("Quiet in Clapham for 4");
  await page.getByRole("button", { name: "Sort it", exact: true }).click();
  await expect(page.getByTestId("plan-route-summary")).toBeVisible({ timeout: 30_000 });
}

test.describe("the Plan result is a route", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("heading, one summary line, three cards, two walks, and no venue-name field", async ({ page }) => {
    await sortARoute(page);

    await expect(page.getByRole("heading", { level: 2, name: /^(Tonight|Today) in Clapham$/ })).toBeVisible();
    await expect(page.getByTestId("plan-route-summary")).toHaveText("3 stops · £17.40 each · 9 min walk");
    await expect(page.locator(".planStops input")).toHaveCount(0);

    const cards = page.locator(".planComposer__stop");
    await expect(cards).toHaveCount(3);
    await expect(cards.locator(".planStop__name")).toHaveText(["Arnos Arms", "The Bohemia", "The Elephant Inn"]);
    await expect(cards.locator(".planStop__price")).toHaveText(["£5.60", "£5.20", "£6.60"]);
    const walks = page.locator(".planStop__walkLabel");
    await expect(walks).toHaveText(["4 min walk", "5 min walk"]);

    // The honest provenance line sits under the summary, never over a stop.
    await expect(page.getByText(/^Pub list refreshed /)).toBeVisible();
    // The settings are not in front of the answer.
    await expect(page.locator(".planComposer__context")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sort it again" })).toHaveCount(0);
  });

  test("Tune details holds the settings, and closes on Escape", async ({ page }) => {
    await sortARoute(page);
    await page.getByRole("button", { name: "Tune details" }).click();
    const sheet = page.getByRole("dialog", { name: "Tune details" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("combobox", { name: "Area" })).toHaveValue("clapham");
    await expect(sheet.getByRole("button", { name: "Sort it again" })).toBeVisible();
    // 16px inputs: iOS zooms the page into anything smaller.
    const size = await sheet.getByRole("textbox", { name: "Describe the outing" }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });

  test("Alt and the arrow keys move a stop, and a pure reorder never asks for a refresh", async ({ page }) => {
    await sortARoute(page);
    await page.locator(".planStop__open").nth(1).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(page.locator(".planStop__name")).toHaveText(["The Bohemia", "Arnos Arms", "The Elephant Inn"]);
    // Same venues, same proof: the route is still lockable.
    await expect(page.locator(".planComposer__routeStale")).toHaveCount(0);
    await expect(page.locator("#plan-route-status")).toContainText("moved to place 1");
  });

  test("removing a stop asks for a refresh and keeps the other cards", async ({ page }) => {
    await sortARoute(page);
    await page.locator(".planStop__open").nth(2).focus();
    await page.keyboard.press("Delete");
    await expect(page.locator(".planComposer__stop")).toHaveCount(2);
    await expect(page.locator(".planComposer__routeStale")).toBeVisible();
  });

  test("a stop added by hand is a pub finder until a pub is chosen", async ({ page }) => {
    await sortARoute(page);
    await page.getByRole("button", { name: "Add another stop" }).click();
    const finder = page.getByLabel("Find a pub for stop 4");
    await expect(finder).toBeVisible();
    await expect(page.locator(".planStops input")).toHaveCount(1);
  });
});

// Real touch input over CDP (Playwright has no swipe): a pointer that reports
// itself as touch, so the card's own long-press lift and swipe-to-remove run
// exactly as they do on a phone. The pointer media are forced coarse because
// emulated touch alone leaves the page reading (hover: hover).
test.describe("the stop cards under a thumb", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  async function touchPage(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "pointer", value: "coarse" }, { name: "hover", value: "none" }],
    });
    await sortARoute(page);
    await page.evaluate(() => {
      const top = document.querySelector(".planStops")!.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top - 150);
    });
    await page.waitForTimeout(300);
    const touch = (type: string, x: number, y: number) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] } as never);
    const surface = async (index: number) => {
      const box = await page.locator(".planStop__surface").nth(index).boundingBox();
      if (!box) throw new Error(`no card ${index}`);
      return box;
    };
    return { touch, surface };
  }

  test("a swipe left shows Remove, and Remove drops the stop", async ({ page }) => {
    const { touch, surface } = await touchPage(page);
    const card = await surface(1);
    const y = card.y + card.height / 2;
    await touch("touchStart", card.x + 160, y);
    for (let step = 1; step <= 8; step += 1) await touch("touchMove", card.x + 160 - step * 14, y);
    await touch("touchEnd", 0, 0);
    await expect(page.locator(".planStop[data-revealed='true']")).toHaveCount(1);
    await page.getByRole("button", { name: "Remove stop 2" }).click();
    await expect(page.locator(".planComposer__stop")).toHaveCount(2);
    await expect(page.locator(".planComposer__routeStale")).toBeVisible();
  });

  test("a still hold lifts a card, and dropping it above another reorders the route", async ({ page }) => {
    const { touch, surface } = await touchPage(page);
    const last = await surface(2);
    const first = await surface(0);
    const x = last.x + 120;
    const y = last.y + last.height / 2;
    await touch("touchStart", x, y);
    await page.waitForTimeout(450);
    await expect(page.locator(".planStop[data-lifted='true']")).toHaveCount(1);
    const target = first.y + 10;
    for (let step = 1; step <= 14; step += 1) await touch("touchMove", x, y + ((target - y) * step) / 14);
    await touch("touchEnd", 0, 0);
    await expect(page.locator(".planStop__name")).toHaveText(["The Elephant Inn", "Arnos Arms", "The Bohemia"]);
    // A pure reorder keeps the proof the generator minted, so it still locks.
    await expect(page.locator(".planComposer__routeStale")).toHaveCount(0);
  });

  test("a scroll that starts on a card is still a scroll", async ({ page }) => {
    const { touch, surface } = await touchPage(page);
    const card = await surface(1);
    const before = await page.evaluate(() => window.scrollY);
    const x = card.x + 160;
    const y = card.y + card.height / 2;
    await touch("touchStart", x, y);
    for (let step = 1; step <= 10; step += 1) await touch("touchMove", x, y - step * 12);
    await touch("touchEnd", 0, 0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
    await expect(page.locator(".planStop__name")).toHaveText(["Arnos Arms", "The Bohemia", "The Elephant Inn"]);
  });
});
