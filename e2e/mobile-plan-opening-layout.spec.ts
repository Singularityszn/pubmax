import { expect, test, type Page } from "@playwright/test";

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
    // measures sits behind that entry surface's "Guide me instead" link.
    // Clicking it can scroll the link itself into view first; the wizard is
    // its own fresh opening screen, so reset to the top before measuring
    // its layout, the same as any other screen transition would start.
    await page.getByRole("button", { name: "Guide me instead" }).click();
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
