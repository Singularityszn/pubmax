import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectTappable(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(box.height, `${label} should meet the 44px tap target`).toBeGreaterThanOrEqual(44);
  expect(box.width, `${label} should meet the 44px tap target`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.ceil(root.scrollWidth - root.clientWidth);
  });
  expect(overflow, "first-run tour should not horizontally overflow").toBeLessThanOrEqual(1);
}

test.describe("mobile first-run tour", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.removeItem("pubmax-tour-v1-done");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  test("presents thumb-safe onboarding controls before first value", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/pubs");

    const tour = page.getByRole("dialog", { name: "PUBMAXXING" });
    await expect(tour).toBeVisible();
    await expectTappable(tour.getByRole("button", { name: "Skip the tour" }), "tour close");
    await expectTappable(tour.getByRole("button", { name: "Skip", exact: true }), "tour skip");
    await expectTappable(tour.getByRole("button", { name: "Next", exact: true }), "tour next");
    await expectNoHorizontalOverflow(page);

    await tour.getByRole("button", { name: "Next", exact: true }).click();
    const nextStepTour = page.getByRole("dialog", { name: "Find pints near you" });
    await expect(nextStepTour.getByRole("heading", { name: "Find pints near you" })).toBeVisible();
    await expectTappable(nextStepTour.getByRole("button", { name: "Back", exact: true }), "tour back");

    await nextStepTour.getByRole("button", { name: "Skip the tour" }).click();
    await expect(nextStepTour).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("pubmax-tour-v1-done"))).toBe("1");
  });

  test("does not cover the dedicated You or Pub Pal onboarding", async ({ page }) => {
    await page.goto("/u/you", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("dialog", { name: "PUBMAXXING" })).toHaveCount(0);

    await page.goto("/pal", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("dialog", { name: "PUBMAXXING" })).toHaveCount(0);
    await page.getByRole("button", { name: /Meet your Pub Pal/i }).click();
    await expect(page.getByRole("heading", { name: "The grown-up bit first." })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const actions = document.querySelector(".palOnboardingActions")?.getBoundingClientRect();
      const tabs = document.querySelector('nav[aria-label="Primary"]')?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        gap: actions && tabs ? tabs.top - actions.bottom : -1,
      };
    });
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(geometry.gap).toBeGreaterThanOrEqual(8);
  });
});
