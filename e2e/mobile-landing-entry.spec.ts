import { expect, test, type Locator, type Page } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectTappable(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(box.height, `${label} should meet the 44px mobile tap target`).toBeGreaterThanOrEqual(44);
  expect(box.width, `${label} should be wide enough to tap`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.ceil(root.scrollWidth - root.clientWidth);
  });
  expect(overflow, "page should not horizontally overflow at 390px").toBeLessThanOrEqual(1);
}

test.describe("mobile landing entry", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  test("keeps the first-run entry path tappable and unclipped", async ({ page }) => {
    const errors = pageErrors(page);
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { name: "Make tonight worth remembering.", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    await expectTappable(
      page.getByRole("link", { name: "Open the map" }).first(),
      "hero Open the map CTA",
    );
    await expectTappable(page.getByRole("link", { name: "How it works" }).first(), "hero How it works CTA");
    await expectTappable(page.getByRole("link", { name: "Meet your Pub Pal" }).first(), "hero Pub Pal CTA");
    await expectTappable(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Map" }), "bottom Map tab");

    const visibleHeroPins = page.locator(".thamesHeroPin:visible");
    const pinCount = await visibleHeroPins.count();
    expect(pinCount, "phone hero should keep only the tappable, non-crowded pins").toBeGreaterThanOrEqual(3);
    for (let i = 0; i < Math.min(pinCount, 4); i++) {
      await expectTappable(visibleHeroPins.nth(i), `hero drink pin ${i + 1}`);
    }

    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test("routes primary mobile CTAs to the map and secondary exploration", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "How it works" }).first().click();
    await expect(page).toHaveURL(/\/#wedge$/);
    await page.goto("/");
    await expectNoHorizontalOverflow(page);

    await page.getByRole("link", { name: "Meet your Pub Pal" }).first().click();
    await expect(page).toHaveURL(/\/pal$/);
    await page.goto("/");

    await page.getByRole("link", { name: "Open the map" }).first().click();
    await expect(page).toHaveURL(/\/(choose-city|map)/);
  });
});
