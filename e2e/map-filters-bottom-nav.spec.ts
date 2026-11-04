import { test, expect, type Page } from "@playwright/test";
import { expectMobileMapShellReady, mobileMapShellControl } from "./helpers/mobileMapShell";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

test.describe("map filters sheet and bottom navigation", () => {
  test("primary tabs stay tappable above an open filters sheet", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-01-15T18:00:00Z"));
    await page.goto("/map");

    await (await mobileMapShellControl(page, "filters")).click();
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
    await expect(sheet).toBeVisible();

    const tonight = primaryNav(page).getByRole("link", { name: "Tonight", exact: true });
    await expect(tonight).toBeVisible();
    await tonight.click({ force: false });

    await expect(page).toHaveURL(/\/tonight$/);
    await expect(sheet).toHaveCount(0);
  });

  test("the current Map tab dismisses its sheet and restores the first search click", async ({ page }) => {
    await page.goto("/map");
    const filters = await mobileMapShellControl(page, "filters");
    await filters.click();
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
    await expect(sheet).toBeVisible();
    const map = primaryNav(page).getByRole("link", { name: "Explore", exact: true });
    await expect(map).toHaveAttribute("aria-current", "page");
    await map.click();
    await expect(sheet).toHaveCount(0);
    const search = await mobileMapShellControl(page, "search");
    await search.click();
    const input = page.getByRole("combobox", { name: "Search pubs" });
    await expect(input).toBeVisible();
    await input.fill("White");
    await expect(page.getByRole("group", { name: "Areas", exact: true })
      .getByRole("option", { name: /Whitechapel/i })).toBeVisible();
  });

  // Once the reader has been answered, the consent card takes the outing pill's
  // slot on the phone map (components/mobile/mobileMapShell.css), and an open
  // filters sheet still covers it. e2e/first-run-chrome-share.spec.ts owns the
  // stranger's first paint and the pill coming back.
  test("analytics consent takes the pill's slot and hides behind an open filters sheet", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
      window.sessionStorage.setItem("pubmax:consent-answer-moment:v1", "venue-sheet");
    });
    await page.goto("/map");

    const consent = page.locator(".analyticsConsentPrompt");
    const pill = page.locator(".mobilePlanActivation");
    await expect(consent).toBeVisible({ timeout: 30_000 });
    await expectMobileMapShellReady(page);
    await expect(pill).toHaveCount(1, { timeout: 30_000 });
    await expect(pill).toBeHidden();

    await (await mobileMapShellControl(page, "filters")).click();
    await expect(page.locator('.mobileSheetPortal[data-sheet-kind="filters"]')).toBeVisible();

    await expect(consent).toBeHidden();
  });
});
