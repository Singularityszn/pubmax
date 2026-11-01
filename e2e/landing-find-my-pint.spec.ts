import { expect, test, type Page } from "@playwright/test";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

import {
  LANDING_FIRST_RUN_HREF,
  LANDING_PRIMARY_HREF,
  LANDING_PRIMARY_NAME,
  NEAR_FIRST_RUN_CHIP_NAME,
  LANDING_RECEIPT_HREF,
  LANDING_RECEIPT_NAME,
} from "./helpers/landingHero";

// The live desktop browser reserves a scrollbar gutter, including at phone
// viewport widths. Playwright hides it by default and misses that layout.
test.use({
  launchOptions: async ({ browserName, launchOptions }, provide) => {
    if (browserName !== "chromium" || launchOptions.ignoreDefaultArgs === true) {
      await provide(launchOptions);
      return;
    }
    const ignored = Array.isArray(launchOptions.ignoreDefaultArgs) ? launchOptions.ignoreDefaultArgs : [];
    await provide({ ...launchOptions, ignoreDefaultArgs: [...new Set([...ignored, "--hide-scrollbars"])] });
  },
});

// Permanent one-action hierarchy (captain 2026-09-03, issue #1354; 2026-09-04,
// issue #1357; rebuilt 2026-09-07). No build flag changes this contract: the
// near-me answer is the one primary, the price receipt door is the first quiet
// door ("Log what you paid", through the pub picker) with Tonight beside it, the hero fills the
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
  await expect(nav.getByRole("link")).toHaveText(["Explore", "Tonight", "Plan", "Spoons", "Social", "You"]);
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

  // The first answer says what it is worth in pounds (nearSavingLine,
  // lib/nearMeAnswer.ts): against the nearest pub with a listed price, with
  // that pub's own price and its publisher and read day, so the sum and its
  // source can be checked. A reader who already
  // allowed location gets it on the landing card with no tap, and /near
  // prints the same line. Soho has a dearer doorstep pub in the shipped data.
  test("an allowed location answers with the saving in pounds, on the card and on /near", async ({ page, context }) => {
    test.setTimeout(60_000);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 51.5136, longitude: -0.134 });
    await openLanding(page, { width: 390, height: 844 });

    const saving = /^.+ is £\d+\.\d{2} a pint less than .+, the nearest pub with a listed price \(£\d+\.\d{2}, (right here|\d+\.\d km)\)\.$/;
    await expect(page.getByTestId("landing-saving-line")).toHaveText(saving, { timeout: 20_000 });
    // The doorstep pub's price carries its own publisher and read day, or
    // says why it cannot, like every printed price.
    await expect(page.getByTestId("landing-saving-source")).toHaveText(
      /^.+: (Listed by .+|Publisher could not be checked|No publisher recorded)(, source read .+|, read day not recorded)\.$/,
      { timeout: 20_000 },
    );

    await page.goto("/near?locate=1");
    await expect(page.getByTestId("near-saving-line")).toHaveText(saving, { timeout: 20_000 });
    await expect(page.getByTestId("near-saving-source")).toHaveText(/^.+: On record · (?!Checking).+$/, { timeout: 20_000 });
  });

  test("shows a sourced pub card and keeps the general price door separate", async ({ page }) => {
    await openLanding(page, { width: 1440, height: 900 });
    const card = page.locator(".lpHero .lpPubCard");
    await expect(card).toBeVisible();
    await expect(card.locator(".lpPubName a")).toHaveAttribute("href", /\/map\?sel=/);
    await expect(card.locator(".priceBadge").first()).toContainText(/£\d+\.\d\d/);
    await expect(card.locator(".lpPubSource")).toContainText(/source read \d+ \w+ \d{4}\./);
    await expect(card.locator(".lpStanding")).toContainText("Listed");
    await expect(card.locator(".lpPubThen")).toContainText(/£\d+\.\d\d in \w+ \d{4}\./);
    await expect(card.locator(".lpPubThenSource a")).toHaveAttribute("href", /^https?:\/\//);

    const receipt = page.locator(".lpHero .screenSecondary a").first();
    await expect(receipt).toHaveText(LANDING_RECEIPT_NAME);
    await expect(receipt).toHaveAttribute("href", LANDING_RECEIPT_HREF);

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

  test("the general receipt door opens a pub picker before a blank price form", async ({ page }) => {
    test.slow();
    await openLanding(page, { width: 390, height: 844 });
    const receipt = page.locator(".lpHero .screenSecondary a").first();
    await expect(receipt).toHaveText(LANDING_RECEIPT_NAME);
    await receipt.click();
    await expect(page).toHaveURL(/\/map\?log=1$/);
    const picker = page.locator(".logIntentFallback:visible");
    await expect(picker).toBeVisible({ timeout: 45_000 });
    await expect(picker.getByRole("button", { name: "Search pubs", exact: true })).toBeVisible();
    await expect(picker.getByRole("button", { name: "Near me", exact: true })).toBeVisible();
    await expect(page.locator(".spillPriceStep .priceStepper input")).toHaveCount(0);
    const pub = picker.locator(".logIntentNearbyBtn").first();
    const priceInput = page.locator(".spillPriceStep .priceStepper input");
    await expect(async () => {
      if (await pub.isVisible()) await pub.click({ timeout: 2_000 });
      await expect(priceInput).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(priceInput).toHaveValue("");
    await expect(priceInput).toBeEditable();
  });

  test("a pub-specific price link keeps that pub's printed price editable", async ({ page }) => {
    test.slow();
    await openLanding(page, { width: 390, height: 844 });
    const row = page.locator(".lpHero .lpRailRow").first();
    const figure = (await row.locator(".priceBadge").textContent())!.trim().replace(/^£/, "");
    await row.locator("a").click();
    await expect(page).toHaveURL(/\/map\?sel=[^&]+&log=1&price=\d+\.\d\d$/);
    const priceInput = page.locator(".spillPriceStep .priceStepper input");
    await expect(priceInput).toHaveValue(figure, { timeout: 30_000 });
    await expect(priceInput).toBeEditable();
  });

  // Both viewports, because a mobile-only check cannot see a hero that shrinks
  // on a wide layout and a desktop-only check cannot see the fold on a phone.
  // 320x568 is the shortest phone: there the fixed tab bar, not the
  // viewport's edge, is what the primary has to clear.
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
      // ends above the tab bar, and a tap on its centre lands on it rather than
      // on a tab. No floating create action stands on it (captain, 1 Nov 2026).
      if (viewport.width <= 640) {
        const primaryNav = page.getByRole("navigation", { name: "Primary", exact: true });
        await expect(primaryNav).toHaveCount(1);
        await expect(primaryNav).toBeVisible();
        const tabBar = await primaryNav.boundingBox();
        expect(tabBar).not.toBeNull();
        expect(box!.y + box!.height).toBeLessThanOrEqual(tabBar!.y);
        await expect(page.getByTestId("create-fab")).toHaveCount(0);
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

async function prepareClearanceLanding(page: Page, theme: "light" | "dark", withPal: boolean) {
  const now = "2026-10-26T12:00:00.000Z";
  const pal = {
    ...DEFAULT_PAL_DRAFT,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ownerId: ACCOUNTS.A.id,
    name: "Ripley",
    adultAttestedAt: now,
    muted: false,
    hidden: false,
    proposalPreferences: {},
    masteryPoints: 0,
    createdAt: now,
    updatedAt: now,
  };
  if (withPal) {
    await installAuthDoubles(page);
    await page.route("**/api/pub-pal", (route) => route.fulfill({ json: { pal, adultOnFile: true } }));
    await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
  }
  await page.addInitScript(({ theme, withPal, pal }) => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax-theme", theme);
    localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
    if (withPal) {
      localStorage.setItem("pubmax_account_owner", pal.ownerId);
      localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify(pal));
    } else {
      localStorage.removeItem("pubmax_pub_pal_v1");
    }
  }, { theme, withPal, pal });
  if (withPal) await seedSignedIn(page, "A");
}

async function expectLandingPrimaryClear(page: Page, viewport: { width: number; height: number }) {
  const primary = page.locator(".lpHero [data-primary-action]").getByRole("link", { name: LANDING_PRIMARY_NAME });
  if (page.context().browser()?.browserType().name() === "chromium") {
    await expect.poll(() => page.evaluate(() => window.innerWidth - document.documentElement.clientWidth)).toBeGreaterThan(0);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const primaryBox = (await primary.boundingBox())!;
  expect(primaryBox.height).toBeGreaterThanOrEqual(44);
  expect(primaryBox.y).toBeGreaterThanOrEqual(0);
  expect(primaryBox.y + primaryBox.height).toBeLessThanOrEqual(viewport.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

  for (const floating of await page.locator(".palSummon").all()) {
    if (!await floating.isVisible()) continue;
    const box = (await floating.boundingBox())!;
    const overlaps = primaryBox.x < box.x + box.width
      && primaryBox.x + primaryBox.width > box.x
      && primaryBox.y < box.y + box.height
      && primaryBox.y + primaryBox.height > box.y;
    expect(overlaps, `Primary action overlaps ${await floating.getAttribute("class")}`).toBe(false);
  }

  const hitOwnership = await primary.evaluate((link) => {
    const box = link.getBoundingClientRect();
    return [0.1, 0.5, 0.9].flatMap((x) => [0.1, 0.5, 0.9].map((y) =>
      link.contains(document.elementFromPoint(box.x + box.width * x, box.y + box.height * y)),
    ));
  });
  expect(hitOwnership).toEqual(Array<boolean>(9).fill(true));
}

for (const textSize of [16, 32]) {
// The floating Create these actions once had to clear left with the five-tab
// dock (captain, 1 Nov 2026); they still own every point of their own box.
test(`homepage quiet actions remain clickable on a narrow phone with ${textSize}px text`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await prepareClearanceLanding(page, "dark", false);
  await page.goto("/");
  await expect(page.locator(".lpHero [data-primary-action]").getByRole("link", { name: LANDING_PRIMARY_NAME })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create", exact: true })).toHaveCount(0);
  await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, textSize);
  await page.evaluate(() => document.fonts.ready);
  if (page.context().browser()?.browserType().name() === "chromium") {
    await expect.poll(() => page.evaluate(() => window.innerWidth - document.documentElement.clientWidth)).toBeGreaterThan(0);
  }

  for (const link of await page.locator(".lpHero .screenSecondary a").all()) {
    await link.scrollIntoViewIfNeeded();
    const hits = await link.evaluate((anchor) => {
      const box = anchor.getBoundingClientRect();
      return [0.1, 0.5, 0.9].flatMap((x) => [0.1, 0.5, 0.9].map((y) =>
        anchor.contains(document.elementFromPoint(box.x + box.width * x, box.y + box.height * y)),
      ));
    });
    expect(hits, await link.innerText()).toEqual(Array<boolean>(9).fill(true));
  }

  await page.getByRole("link", { name: "What's on tonight", exact: true }).click();
  await expect(page).toHaveURL(/\/tonight$/);
});
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  for (const theme of ["light", "dark"] as const) {
    for (const withPal of [false, true]) {
      test(`homepage action clears floating controls at ${viewport.width}px, ${theme}, ${withPal ? "saved Pal" : "no saved Pal"}`, async ({ page }) => {
        await page.setViewportSize(withPal ? { width: 1440, height: 900 } : viewport);
        await prepareClearanceLanding(page, theme, withPal);
        await page.goto("/");
        if (withPal) {
          await expect(page.getByRole("link", { name: "Summon Ripley, your Pub Pal", exact: true })).toBeVisible();
          await page.setViewportSize(viewport);
        }

        const primary = page.locator(".lpHero [data-primary-action]").getByRole("link", { name: LANDING_PRIMARY_NAME });
        // The Pal's door is in the landing's top bar now, and no floating
        // create action stands over the first pub card (captain, 1 Nov 2026).
        const topBar = page.locator("header.lpNav");
        const palDoor = topBar.getByRole("link", { name: withPal ? "Pub Pal, Ripley" : "Pub Pal", exact: true });
        await expect(primary).toHaveAttribute("href", LANDING_PRIMARY_HREF);
        await expect(page.getByRole("button", { name: "Create", exact: true })).toHaveCount(0);
        await expect(palDoor).toBeVisible();
        await expect(palDoor).toHaveAttribute("href", "/pal");
        // The top bar carries the Pal, so the floating Pal shortcut stays down.
        await expect(page.locator(".palSummon")).toBeHidden();

        await expectLandingPrimaryClear(page, viewport);
      });
    }
  }
}

test("desktop homepage retains the saved Pal shortcut beside the primary action", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareClearanceLanding(page, "dark", true);
  await page.goto("/");
  const primary = page.locator(".lpHero [data-primary-action]").getByRole("link", { name: LANDING_PRIMARY_NAME });
  const summon = page.getByRole("link", { name: "Summon Ripley, your Pub Pal", exact: true });
  await expect(primary).toBeVisible();
  await expect(summon).toBeVisible();
  await expect(summon).toHaveAttribute("href", "/pal");
  const action = (await primary.boundingBox())!;
  const shortcut = (await summon.boundingBox())!;
  expect(action.y + action.height).toBeLessThanOrEqual(shortcut.y);
});

// This doubles CSS text size in a desktop engine. It does not simulate native
// Dynamic Type, browser zoom, a phone keyboard, or nonzero safe-area insets.
for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`homepage action remains readable and clear after scrolling with doubled text at ${viewport.width}px`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await prepareClearanceLanding(page, "dark", true);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Summon Ripley, your Pub Pal", exact: true })).toBeVisible();
    await page.setViewportSize(viewport);

    const primary = page.locator(".lpHero [data-primary-action]").getByRole("link", { name: LANDING_PRIMARY_NAME });
    const normalFontSize = await primary.evaluate((link) => parseFloat(getComputedStyle(link).fontSize));
    await page.evaluate(() => {
      const root = document.documentElement;
      root.style.fontSize = `${parseFloat(getComputedStyle(root).fontSize) * 2}px`;
    });
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => primary.evaluate((link) => parseFloat(getComputedStyle(link).fontSize)))
      .toBeCloseTo(normalFontSize * 2, 1);

    // Larger text may move the action below the first screen. It must remain
    // reachable and readable when the reader scrolls to it.
    await primary.evaluate((link) => link.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(page.locator(".createFabRoot")).toHaveCount(0);
    await expectLandingPrimaryClear(page, viewport);

    const textFits = await primary.evaluate((link) => {
      const box = link.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(link);
      const lines = [...range.getClientRects()];
      return lines.length > 0 && lines.every((line) =>
        line.left >= box.left - 1 && line.right <= box.right + 1
        && line.top >= box.top - 1 && line.bottom <= box.bottom + 1,
      );
    });
    expect(textFits, "The whole enlarged label stays inside the primary button").toBe(true);
    const palDoor = page.locator("header.lpNav")
      .getByRole("link", { name: "Pub Pal, Ripley", exact: true });
    await expect(palDoor).toBeVisible();
    await expect(palDoor).toHaveAttribute("href", "/pal");
    await expect(page.getByRole("link", { name: "Summon Ripley, your Pub Pal", exact: true })).toBeHidden();
  });
}
