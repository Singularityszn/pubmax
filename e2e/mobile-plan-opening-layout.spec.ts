import { expect, test, type Page } from "@playwright/test";

import { storeThemeChoice } from "./helpers/themeClock";

const MOBILE_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

async function prepareBlankPlan(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.removeItem("pubmax:plan-intake:v1");
    window.localStorage.removeItem("pubmax:nightPatch:v1");
    window.sessionStorage.removeItem("pubmax:plan-draft:v1");
  });
}

test.describe("the first Plan step with consent pending", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
    storageState: { cookies: [], origins: [] },
  });

  test("keeps both actions clear of the phone bars on entry", async ({ page }) => {
    await storeThemeChoice(page, "dark");
    await page.addInitScript(() => {
      sessionStorage.setItem("pubmax:consent-answer-moment:v1", "second-route");
    });
    await page.goto("/plan");

    const consent = page.getByRole("complementary", { name: "Anonymous analytics choice" });
    const tabBar = page.getByRole("navigation", { name: "Primary" });
    await expect(consent).toBeVisible();
    await expect(tabBar).toBeVisible();
    await page.getByRole("button", { name: "Step by step" }).tap();

    const skip = page.getByRole("button", { name: "Skip for now" });
    const next = page.getByRole("button", { name: "Continue", exact: true });
    await expect(skip).toBeVisible();
    await expect(next).toBeVisible();
    await page.evaluate(async () => { await document.fonts.ready; });

    const [consentBox, tabBarBox] = await Promise.all([consent.boundingBox(), tabBar.boundingBox()]);
    if (!consentBox || !tabBarBox) throw new Error("Phone bars must be visible");
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    for (const action of [skip, next]) {
      const bounds = await action.boundingBox();
      if (!bounds) throw new Error("Plan action must be visible");
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(Math.min(consentBox.y, tabBarBox.y));
    }

    await page.getByRole("button", { name: "Soho", exact: true }).tap();
    await expect(next).toBeEnabled();
    await next.tap();
    await expect(page.getByRole("group", { name: "Choose a time window" })).toBeVisible();
  });
});

test("a new phone plan starts with the description before pub-list import", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareBlankPlan(page);
  await page.goto("/plan");

  const description = page.getByRole("textbox", { name: "Where, how many, what budget" });
  const submit = page.getByRole("button", { name: "Plan it", exact: true });
  const importDoor = page.getByRole("button", { name: "Import a pub list", exact: true });
  // A priced route leads the page, with each price's source, ahead of the
  // field and every option (#3035).
  const starter = page.locator(".planStarter");
  await expect(starter).toContainText("each for pints");
  await expect(starter).toContainText("Source read");
  await expect(description).toBeVisible();
  await expect(submit).toBeInViewport();
  const starterBox = await starter.boundingBox();
  const descriptionBox = await description.boundingBox();
  const submitBox = await submit.boundingBox();
  const importBox = await importDoor.boundingBox();
  expect(starterBox).not.toBeNull();
  expect(descriptionBox).not.toBeNull();
  expect(submitBox).not.toBeNull();
  expect(importBox).not.toBeNull();
  expect(starterBox!.y + starterBox!.height).toBeLessThanOrEqual(descriptionBox!.y);
  expect(importBox!.y).toBeGreaterThan(submitBox!.y + submitBox!.height);
  expect(descriptionBox!.y + descriptionBox!.height).toBeLessThan(844);

  await expect(async () => {
    await importDoor.click();
    await expect(page.getByRole("dialog", { name: "Import a pub list" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Close Import a pub list", exact: true }).click();
  await expect(importDoor).toBeFocused();
});

for (const viewport of MOBILE_VIEWPORTS) {
  test(`Plan opening screen clears fixed navigation at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await prepareBlankPlan(page);

    const response = await page.goto("/plan");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".mobileTabBar").filter({ visible: true })).toBeVisible();

    if (viewport.width === 390) {
      // The head is the Screen primitive's since #1402, so it wears the launch
      // typography tokens rather than the bespoke display treatment this used
      // to pin (line-height .88, tracking -.065em, a 10px margin). The tokens
      // are read off the document rather than typed here, so a governed token
      // change moves this assertion with it instead of rotting it: the claim
      // is that the head takes the launch scale, not that the scale is 1.12.
      const phoneStyles = await page.locator(".planPage__intro h1").evaluate((heading) => {
        const style = getComputedStyle(heading);
        const root = getComputedStyle(document.documentElement);
        const fontSize = Number.parseFloat(style.fontSize);
        return {
          fontSize,
          lineHeight: Number.parseFloat(style.lineHeight),
          letterSpacing: Number.parseFloat(style.letterSpacing),
          leadingTight: Number.parseFloat(root.getPropertyValue("--leading-tight")),
          trackingTightEm: Number.parseFloat(root.getPropertyValue("--tracking-tight")),
        };
      });
      expect(phoneStyles.leadingTight).toBeGreaterThan(0);
      expect(phoneStyles.lineHeight).toBeCloseTo(
        phoneStyles.fontSize * phoneStyles.leadingTight,
        1,
      );
      expect(phoneStyles.letterSpacing).toBeCloseTo(
        phoneStyles.fontSize * phoneStyles.trackingTightEm,
        1,
      );
    }

    // /plan opens on the describe-first question; the wizard this test
    // measures sits behind that entry surface's "Step by step" link.
    // Clicking it can scroll the link itself into view first; the wizard is
    // its own fresh opening screen, so reset to the top before measuring
    // its layout, the same as any other screen transition would start.
    await page.getByRole("button", { name: "Step by step" }).click();
    await page.evaluate(() => window.scrollTo(0, 0));

    const heading = page.getByRole("heading", {
      name: "Where should the night happen?",
    });
    const firstChoice = page.getByRole("button", { name: "Use my location" });
    await expect(heading).toBeVisible();
    await expect(firstChoice).toBeVisible();
    const geometry = await page.locator(".planPage").evaluate((planPage) => {
      const headingElement =
        planPage.querySelector<HTMLElement>("#plan-intake-title");
      const firstChoiceElement =
        planPage.querySelector<HTMLElement>(".planIntake__locate");
      const navigationElement =
        document.querySelector<HTMLElement>(".mobileTabBar");
      if (!headingElement || !firstChoiceElement || !navigationElement) {
        throw new Error("Plan opening geometry is incomplete");
      }
      const headingRect = headingElement.getBoundingClientRect();
      const firstChoiceRect = firstChoiceElement.getBoundingClientRect();
      const navigationRect = navigationElement.getBoundingClientRect();
      return {
        scrollY: window.scrollY,
        headingBottom: headingRect.bottom,
        firstChoiceBottom: firstChoiceRect.bottom,
        navigationTop: navigationRect.top,
      };
    });
    expect(geometry.scrollY).toBe(0);

    expect(
      geometry.headingBottom,
      "first Plan heading must end above fixed navigation",
    ).toBeLessThanOrEqual(geometry.navigationTop);
    expect(
      geometry.firstChoiceBottom,
      "first Plan choice must be fully visible above fixed navigation",
    ).toBeLessThanOrEqual(geometry.navigationTop);
  });
}
