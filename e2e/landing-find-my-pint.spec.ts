import { expect, test, type Page } from "@playwright/test";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

import {
  LANDING_PRIMARY_HREF,
  LANDING_PRIMARY_NAME,
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

async function openLanding(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.removeItem("pubmax:fair-pint:v1");
  });
  expect((await page.goto("/", { waitUntil: "domcontentloaded" }))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("landing nav speaks the app's vocabulary and the footer keeps Social", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-30T19:00:00Z"));
  await openLanding(page, { width: 1440, height: 900 });
  const nav = page.getByRole("navigation", { name: "Landing navigation" });
  await expect(nav.getByRole("link")).toHaveText(["Explore", "Tonight", "Plan", "Spoons", "Social", "You"]);
  await expect(page.locator(".lpFooterCol").getByRole("link", { name: "Social", exact: true })).toHaveCount(1);
});

// The required map-first journey is public for both account states.
for (const signedIn of [false, true]) {
  test(`the slider opens the chosen map budget when ${signedIn ? "signed in" : "signed out"}`, async ({ page }) => {
    await installAuthDoubles(page);
    if (signedIn) await seedSignedIn(page, "A");
    await openLanding(page, { width: 390, height: 844 });
    const slider = page.getByRole("slider", { name: "Fair pint price" });
    await expect(async () => {
      await slider.focus();
      await slider.press("Home");
      await slider.press("ArrowRight");
      await expect(slider).toHaveValue("310");
      await expect(page.locator("output")).toHaveText("£3.10", { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    const primary = page.locator(".landingMapHero").getByRole("link", { name: LANDING_PRIMARY_NAME });
    await expect(primary).toHaveAttribute("href", "/map?max=3.1");
    await expect(async () => {
      if (new URL(page.url()).pathname === "/") await primary.click();
      await expect(page).toHaveURL(/\/map\?max=3\.1$/, { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
  });
}

test("the map and slider lead the page while extra discovery stays folded", async ({ page }) => {
  await openLanding(page, { width: 390, height: 844 });
  const hero = page.locator(".landingMapHero");
  await expect(hero.getByRole("img")).toBeVisible();
  await expect(hero.getByRole("slider")).toBeVisible();
  await expect(hero.getByRole("link", { name: LANDING_PRIMARY_NAME })).toHaveAttribute("href", LANDING_PRIMARY_HREF);
  await expect(page.locator("main [data-primary-action]")).toHaveCount(1);
  const more = page.locator("details.landingMore");
  await expect(more).not.toHaveAttribute("open", "");
  await more.getByText("Explore more prices and places", { exact: true }).click();
  await expect(more).toHaveAttribute("open", "");
  await expect(more.getByRole("link", { name: "Open the map", exact: true })).toBeVisible();
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]) {
  test(`the primary remains above the fold at ${viewport.width}px`, async ({ page }) => {
    await openLanding(page, viewport);
    await expectLandingPrimaryClear(page, viewport);
    if (viewport.width <= 640) {
      const primary = (await page.locator(".landingMapHero [data-primary-action]").boundingBox())!;
      const tabs = (await page.getByRole("navigation", { name: "Primary", exact: true }).boundingBox())!;
      expect(primary.y + primary.height).toBeLessThanOrEqual(tabs.y);
    }
  });
}

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
  const primary = page.locator(".landingMapHero").getByRole("link", { name: LANDING_PRIMARY_NAME });
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

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  for (const theme of ["light", "dark"] as const) {
    for (const withPal of [false, true]) {
      test(`homepage action clears floating controls at ${viewport.width}px, ${theme}, ${withPal ? "saved Pal" : "no saved Pal"}`, async ({ page }) => {
        await page.setViewportSize(withPal ? { width: 1440, height: 900 } : viewport);
        await prepareClearanceLanding(page, theme, withPal);
        await page.goto("/", { waitUntil: "domcontentloaded" });
        if (withPal) {
          await expect(page.getByRole("link", { name: "Summon Ripley, your Pub Pal", exact: true })).toBeVisible();
          await page.setViewportSize(viewport);
        }

        const primary = page.locator(".landingMapHero").getByRole("link", { name: LANDING_PRIMARY_NAME });
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
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const primary = page.locator(".landingMapHero").getByRole("link", { name: LANDING_PRIMARY_NAME });
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
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: "Summon Ripley, your Pub Pal", exact: true })).toBeVisible();
    await page.setViewportSize(viewport);

    const primary = page.locator(".landingMapHero").getByRole("link", { name: LANDING_PRIMARY_NAME });
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
