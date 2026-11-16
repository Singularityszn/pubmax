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
    let releaseLane!: () => void;
    const lanePending = new Promise<void>((resolve) => { releaseLane = resolve; });
    await page.route("**/api/social/posts?lane=london**", async (route) => {
      await lanePending;
      await route.fulfill({ json: { posts: [], nextCursor: null } });
    });

    const response = await page.goto("/feed");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/social\/?$/);
    await expect(
      page.getByRole("heading", { name: "Plans, photos and people" }),
    ).toBeVisible();
    await expect(page.locator(".feedTitle")).toHaveCount(0);
    await expect(page.locator(".feedFilterChip")).toHaveCount(0);
    await expect(page.locator(".feedCard")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    const primarySlot = page.locator("[data-primary-action]").filter({ visible: true });
    const loadingSignIn = primarySlot.getByRole("link", {
      name: "Sign in",
      exact: true,
    });
    await expectTappable(loadingSignIn, "Social loading Sign in");
    await expect(
      page.getByRole("status").getByRole("link", { name: "Sign in" }),
    ).toHaveCount(0);
    // The read-only London lane sits under the door (captain decision 7).
    await expect(page.getByRole("heading", { name: "Across London", exact: true })).toBeVisible();

    // An empty response hides the lane without replacing the focused door.
    await loadingSignIn.focus();
    releaseLane();
    await expect(page.locator(".socialLondonLane")).toHaveCount(0);
    await expect(loadingSignIn).toBeFocused();
    await expectTappable(loadingSignIn, "Focused Social Sign in");
    const openTable = page.getByRole("link", { name: "Explore open crawls", exact: true });
    await expectTappable(openTable, "Social Open Table");
    await expectNoHorizontalOverflow(page);
    await openTable.click();
    await expect(page).toHaveURL(/\/crawls\/?$/);
    await page.goto("/social");
    await loadingSignIn.click();
    await expect(page).toHaveURL(/\/login\?mode=signin&from=%2Fsocial/);
    expect(errors).toEqual([]);
  });
});
