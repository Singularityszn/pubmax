import { expect, test, type Locator, type Page } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.ceil(root.scrollWidth - root.clientWidth);
  });
  expect(overflow, "page should not horizontally overflow at 390px").toBeLessThanOrEqual(1);
}

async function expectTappable(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(Math.round(box.height), `${label} should meet the 44px mobile tap target`).toBeGreaterThanOrEqual(44);
  expect(Math.round(box.width), `${label} should be wide enough to tap`).toBeGreaterThanOrEqual(44);
}

test.describe("mobile Social actions", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  test("signed-out Social door stays thumb-safe without overflow", async ({ page }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/feed");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/social\/?$/);
    await expect(
      page.getByRole("heading", { name: "Crews and people who are already here." }),
    ).toBeVisible();
    await expect(page.locator(".feedTitle")).toHaveCount(0);
    await expect(page.locator(".feedFilterChip")).toHaveCount(0);
    await expect(page.locator(".feedCard")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    const primary = page.locator("[data-primary-action]").getByRole("link", {
      name: "Sign in",
    });
    await expectTappable(primary, "Social Sign in");
    await expect(
      page.getByRole("status").getByRole("link", { name: "Sign in" }),
    ).toHaveCount(0);
    await expect(page.getByText("Sign in to use Social.")).toBeVisible();

    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
