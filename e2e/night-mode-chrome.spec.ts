import { expect, test, type Page } from "@playwright/test";

import { sortDescribeFirst } from "./helpers/planDescribeFirst";
import { setFirstPintIn } from "./helpers/planFirstPint";

// Night mode owns the whole screen, and nothing may own a tap inside it.
//
// verify-preview-4 RED 2 (5 Sep 2026), measured at 320x568 with the analytics
// consent card unset (every new account): the centre of the lower "Get me
// home" slab (y 490 to 554) was owned by the phone tab bar (514 to 568), and
// the centre of "We are here" by the consent card. Both surfaces pass at 844
// tall, which is the one height the chrome suite swept. The bar now steps
// aside for the surface the way it does for a venue sheet (mobileNav.css) and
// the card waits (app/globals.css); this proves it with elementFromPoint at
// the first-generation SE height and at 390x844.

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

const CONSENT_KEY = "pubmaxx:analytics-consent:v1";

test.use({ storageState: { cookies: [], origins: [] } });

async function prepare(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((key) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    // A first-run reader: the consent card is up.
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem("pubmax:prompt-budget:v1");
  }, CONSENT_KEY);
}

/** Lock a plan whose first pint is half an hour out, so the night is ON. */
async function lockAPlanOnTonight(page: Page): Promise<void> {
  await page.goto("/plan");
  await sortDescribeFirst(page, "Quiet in Clapham for 4, not pricey");
  await expect(page.getByText("3 stops we can stand behind, shaped by the outing you set.")).toBeVisible();
  await page.getByLabel("Your name").fill("Karan");
  await setFirstPintIn(page, 30);
  await page.getByRole("button", { name: "Regenerate route" }).click();
  await expect(page.getByText("3 stops we can stand behind, shaped by the outing you set.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/);
}

/** Who owns the centre of `selector`: the element itself, or what covers it. */
async function centreOwner(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return "missing";
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit) return "nothing";
    if (hit === el || el.contains(hit)) return "self";
    if (hit.closest(".mobileTabBar")) return "tab-bar";
    if (hit.closest(".analyticsConsentPrompt")) return "consent";
    return `${hit.tagName.toLowerCase()}.${[...hit.classList].join(".")}`;
  }, selector);
}

for (const viewport of VIEWPORTS) {
  test(`night mode's every action owns its own centre at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.slow();
    await prepare(page, viewport);
    await lockAPlanOnTonight(page);

    const nightMode = page.getByRole("dialog", { name: "Night mode" });
    await expect(nightMode).toBeVisible();
    await expect(page.locator(".nightCrawl__escape")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`night-mode-${viewport.width}x${viewport.height}.png`) });

    // The surface fills the viewport and nothing of the page's chrome is
    // over its foot: the bar has stepped aside (moved off the screen, the
    // way it does under a venue sheet) and the card waits.
    const tabList = page.locator(".mobileTabList");
    if ((await tabList.count()) > 0) {
      await expect
        .poll(() => tabList.evaluate((el) => el.getBoundingClientRect().top))
        .toBeGreaterThanOrEqual(viewport.height - 0.5);
    }
    await expect(page.getByLabel("Anonymous analytics choice")).toBeHidden();

    for (const selector of [
      ".nightCrawl__exit",
      ".nightCrawl__arrive",
      ".nightCrawl__skip",
      ".nightCrawl__escape",
    ]) {
      await expect(page.locator(selector).first()).toBeVisible();
      expect(await centreOwner(page, selector), `${selector} owns its centre`).toBe("self");
    }
    const escape = await page.locator(".nightCrawl__escape").evaluate((el) => el.getBoundingClientRect().bottom);
    expect(escape).toBeLessThanOrEqual(viewport.height);

    // Leaving the surface gives the reader the bar and the card back.
    await page.getByRole("button", { name: "View full plan" }).click();
    await expect(nightMode).toBeHidden();
    await expect(page.getByLabel("Anonymous analytics choice")).toBeVisible();
    if ((await tabList.count()) > 0) {
      await expect
        .poll(() => tabList.evaluate((el) => el.getBoundingClientRect().bottom))
        .toBeLessThanOrEqual(viewport.height + 0.5);
      const mapTab = page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Map", exact: true });
      await expect(mapTab).toBeVisible();
      expect(
        await mapTab.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit === el || el.contains(hit);
        }),
      ).toBe(true);
    }
  });
}
