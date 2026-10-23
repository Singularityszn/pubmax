import { expect, test, type Page } from "@playwright/test";

import {
  LANDING_FIRST_RUN_HREF,
  LANDING_PRIMARY_HREF,
  LANDING_PRIMARY_NAME,
  NEAR_FIRST_RUN_CHIP_NAME,
  LANDING_RECEIPT_HREF,
  LANDING_RECEIPT_NAME,
} from "./helpers/landingHero";

// Permanent one-action hierarchy (captain 2026-09-03, issue #1354; 2026-09-04,
// issue #1357; rebuilt 2026-09-07). No build flag changes this contract: the
// near-me answer is the one primary, the price receipt door is the first quiet
// door ("Log what you paid", into the pub picker before a blank price form)
// with Tonight beside it, the hero fills the
// viewport at every width and the phone order is the desktop order.

async function openLanding(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      name: "What a pint costs, pub by pub.",
      exact: true,
    }),
  ).toBeVisible();
}

// The landing bar is the first navigation most strangers read, so it speaks the
// app's own vocabulary (PRIMARY_NAV_ITEMS) and leads with the loop. Social is
// a main tab (captain, 16 Oct 2026), so the bar carries it once, and the footer
// keeps its own link.
test("landing nav speaks the app's vocabulary and the footer keeps Social", async ({ page }) => {
  await openLanding(page, { width: 1440, height: 900 });

  const nav = page.getByRole("navigation", { name: "Landing navigation" });
  await expect(nav.getByRole("link")).toHaveText(["Map", "Tonight", "Plan", "Social", "You"]);
  await expect(nav.locator('a[href^="/social"]')).toHaveCount(1);
  await expect(nav.locator('a[href^="/moment"]')).toHaveCount(0);

  const footerSocial = page
    .locator(".lpFooterCol")
    .getByRole("link", { name: "Social", exact: true });
  await expect(footerSocial).toHaveCount(1);
});

test.describe("landing hierarchy", () => {
  test("keeps the near-me answer primary and the receipt door first in the quiet row", async ({ page }) => {
    await openLanding(page, { width: 1440, height: 900 });

    const hero = page.locator(".lpHero");
    await expect(hero).toBeVisible();

    const primaries = hero.locator("[data-primary-action] a");
    await expect(primaries).toHaveCount(1);
    await expect(primaries.first()).toHaveAttribute("href", LANDING_PRIMARY_HREF);
    await expect(primaries.first()).toHaveText(LANDING_PRIMARY_NAME);

    // One quiet row, two doors: the receipt door, then Tonight (#1488).
    const secondary = hero.locator(".screenSecondary a");
    await expect(secondary).toHaveCount(2);
    await expect(secondary.first()).toHaveAttribute("href", LANDING_RECEIPT_HREF);
    await expect(secondary.first()).toHaveText(LANDING_RECEIPT_NAME);
    await expect(secondary.nth(1)).toHaveAttribute("href", "/tonight");
    await expect(secondary.nth(1)).toHaveText("What's on tonight");

    // Nothing else on the page is a filled button.
    await expect(page.locator("main [data-primary-action]")).toHaveCount(1);
    await expect(page.locator(".lpButtonPrimary, .lpButtonQuiet")).toHaveCount(0);

    // The map stays one text link below the hero, in the saving section now.
    const mapLink = page
      .locator(".lpWorth")
      .getByRole("link", { name: "Open the map", exact: true });
    await expect(mapLink).toHaveAttribute("href", "/map");
  });

  // Owner decision 16 Oct 2026: the primary answers in ONE tap for everyone. A
  // first-time visitor (no seen mark) lands on /near, not on a five-step
  // setup; refusing location still answers from a patch with the area chips
  // to hand, and the setup is offered there as a chip, never as a gate.
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ] as const) {
    test(`a first-time visitor's one tap answers on /near, even with location refused, at ${viewport.width}`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize(viewport);
      await page.addInitScript(() => {
        window.localStorage.removeItem("pubmax-tour-v1-done");
        window.localStorage.removeItem("pubmax-tour-v2-done");
        window.localStorage.removeItem("pubmax:nightPatch:v1");
        window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
        Object.defineProperty(navigator, "geolocation", {
          configurable: true,
          value: {
            getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) =>
              fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
          },
        });
      });
      await page.goto("/");

      const primary = page.locator(".lpHero [data-primary-action]").getByRole("link", { name: LANDING_PRIMARY_NAME });
      await expect(primary).toHaveAttribute("href", LANDING_PRIMARY_HREF);
      await primary.click();

      await expect(page).toHaveURL(/\/near\?locate=1/);
      await expect(page.getByRole("heading", { name: "London is ready." })).toHaveCount(0);
      await expect(page.getByText("Location's off, so here's central London. Not your patch?")).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".nmnCard").first()).toBeVisible();

      const chip = page.getByRole("link", { name: NEAR_FIRST_RUN_CHIP_NAME, exact: true });
      await expect(chip).toHaveAttribute("href", LANDING_FIRST_RUN_HREF);
    });
  }

  test("shows one real pub with its price, publisher, day and archive line, and a quiet door to choose a pub", async ({ page }) => {
    await openLanding(page, { width: 1440, height: 900 });
    const card = page.locator(".lpHero .lpPubCard");
    await expect(card).toBeVisible();
    await expect(card.locator(".lpPubName a")).toHaveAttribute("href", /\/map\?sel=/);
    await expect(card.locator(".priceBadge").first()).toContainText(/£\d+\.\d\d/);
    await expect(card.locator(".lpPubSource")).toContainText(/collected \d+ \w+ \d{4}\./);
    await expect(card.locator(".lpStanding")).toContainText("Listed");
    await expect(card.locator(".lpPubThen")).toContainText(/£\d+\.\d\d in \w+ \d{4}\./);
    await expect(card.locator(".lpPubThenSource a")).toHaveAttribute("href", /^https?:\/\//);

    // The general receipt door asks which pub before it opens a blank form.
    const receipt = page.locator(".lpHero .screenSecondary a").first();
    await expect(receipt).toHaveText(LANDING_RECEIPT_NAME);
    await expect(receipt).toHaveAttribute("href", "/map?log=1");

    // Three next-cheapest rows under it, each a Pint Drop door of its own,
    // each carrying the figure its own row prints.
    const rows = page.locator(".lpHero .lpRailRow");
    await expect(rows).toHaveCount(3);
    for (const row of await rows.all()) {
      const rowPrice = (await row.locator(".priceBadge").textContent())?.trim();
      expect(rowPrice).toMatch(/£\d+\.\d\d/);
      await expect(row.locator("a")).toHaveAttribute(
        "href",
        `/map?sel=${(await row.locator("a").getAttribute("href"))!.match(/sel=([^&]+)/)![1]}&log=1&price=${rowPrice!.replace("£", "")}`,
      );
    }
    // No location control inside the card (the primary is the near-you door),
    // and exactly ONE door on the page carries the geolocation ask.
    await expect(card.getByRole("button", { name: "Near me" })).toHaveCount(0);
    await expect(page.locator("a[href*='locate=1']")).toHaveCount(1);
  });

  test("the receipt door asks which pub before opening its blank Pint Drop price form", async ({ page }) => {
    test.setTimeout(60_000);
    await openLanding(page, { width: 390, height: 844 });
    const receipt = page.locator(".lpHero .screenSecondary a").first();
    await expect(receipt).toHaveText(LANDING_RECEIPT_NAME);
    await expect(async () => {
      await receipt.click();
      await expect(page).toHaveURL(/\/map\?log=1$/, { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });

    const picker = page.locator(".logIntentFallback:visible");
    await expect(picker).toBeVisible({ timeout: 30_000 });
    await expect(picker.locator("strong")).toHaveText("Pick a pub to log a Pint Drop");
    const priceInput = page.locator(".spillPriceStep .priceStepper input");
    await expect(priceInput).toHaveCount(0);

    const pubName = await picker.locator(".logIntentNearbyBtn > span:first-child").first().innerText();
    const pub = picker.locator(".logIntentNearbyBtn").filter({ has: page.getByText(pubName, { exact: true }) });
    await expect(async () => {
      if (await pub.isVisible()) await pub.click({ timeout: 2_000 });
      await expect(priceInput).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page).toHaveURL((url) => url.searchParams.get("log") === "1" &&
      Boolean(url.searchParams.get("sel")) && !url.searchParams.has("price"));
    await expect(priceInput).toHaveValue("");
    await expect(priceInput).toBeEditable();
  });

  // Both viewports, because a mobile-only check cannot see a hero that shrinks
  // on a wide layout and a desktop-only check cannot see the fold on a phone.
  // 320x568 is the shortest phone: there the fixed tab bar and the create
  // action, not the viewport's edge, are what the primary has to clear.
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ] as const) {
    test(`hero fills the viewport and the primary sits above the fold at ${viewport.width}`, async ({ page }) => {
      await openLanding(page, viewport);
      await page.evaluate(() => window.scrollTo(0, 0));

      const heroBox = await page.locator(".lpHero").boundingBox();
      expect(heroBox).not.toBeNull();
      expect(heroBox!.height).toBeGreaterThanOrEqual(viewport.height - 1);

      const primary = page.locator(".lpHero [data-primary-action] a");
      await expect(primary).toHaveCount(1);
      const box = await primary.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height + 1);

      // On a phone the fixed chrome owns part of that first screen: the primary
      // ends above the tab bar, stays out of the create action's box, and a tap
      // on its centre lands on it rather than on a tab.
      if (viewport.width <= 640) {
        const primaryNav = page.getByRole("navigation", { name: "Primary", exact: true });
        await expect(primaryNav).toHaveCount(1);
        await expect(primaryNav).toBeVisible();
        const tabBar = await primaryNav.boundingBox();
        expect(tabBar).not.toBeNull();
        expect(box!.y + box!.height).toBeLessThanOrEqual(tabBar!.y);
        const create = await page.getByTestId("create-fab").boundingBox();
        expect(create).not.toBeNull();
        const clearOfCreate =
          box!.x + box!.width <= create!.x ||
          box!.y + box!.height <= create!.y ||
          box!.y >= create!.y + create!.height;
        expect(clearOfCreate).toBe(true);
        const hitsPrimary = await primary.evaluate((anchor) => {
          const rect = anchor.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit !== null && anchor.contains(hit);
        });
        expect(hitsPrimary).toBe(true);
      }

      // Every door on the quiet row carries the tap floor, not just the first.
      const quietDoors = page.locator(".lpHero .screenSecondary a");
      const doorCount = await quietDoors.count();
      expect(doorCount).toBeGreaterThan(0);
      for (let index = 0; index < doorCount; index += 1) {
        const door = await quietDoors.nth(index).boundingBox();
        expect(door?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(door?.width ?? 0).toBeGreaterThanOrEqual(44);
      }
    });
  }

  test("reads the same order on a phone as on a desktop: heading, line, picture, primary, quiet row, pub, rail", async ({ page }) => {
    await openLanding(page, { width: 390, height: 844 });
    const tops = await page.evaluate(() =>
      ["#hero-title", ".lpHero .screenLede", ".lpHero .lpLondonFigure", ".lpHero [data-primary-action]", ".lpHero .screenSecondary", ".lpHero .lpPubCard", ".lpHero .lpRail"].map(
        (selector) => document.querySelector(selector)?.getBoundingClientRect().top ?? Number.NaN,
      ),
    );
    for (const top of tops) expect(Number.isFinite(top)).toBe(true);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    // Nothing spills sideways at the narrowest common width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
