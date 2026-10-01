import { expect, test, type Locator } from "@playwright/test";

async function expectTapFloor(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await control.click({ trial: true });
}

test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

test("Out wall discovery has a full-height phone link and opens the wall", async ({ page }) => {
  await page.goto("/out");
  const wall = page.getByRole("link", { name: "Browse the wall", exact: true });
  await expectTapFloor(wall);
  await wall.click();
  await expect(page).toHaveURL(/\/wall(?:\?|$)/);
});

test("Today location policy stays a full-height phone link", async ({ page }) => {
  await page.goto("/today");
  const policy = page.locator(".todayInlineLink");
  await expectTapFloor(policy);
  await expect(policy).toHaveAttribute("href", /privacy|location/);
});

test("Landing photo credits keep full-height phone links", async ({ page }) => {
  await page.goto("/");
  const credits = page.locator(".lpPhotoCredit a");
  await expect(credits.first()).toBeVisible();
  const count = await credits.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await expectTapFloor(credits.nth(index));
    await expect(credits.nth(index)).toHaveAttribute("href", /^https:\/\//);
  }
});
