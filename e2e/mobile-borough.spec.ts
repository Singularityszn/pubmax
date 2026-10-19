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
  expect(box.height, `${label} should meet the 44px mobile tap target`).toBeGreaterThanOrEqual(44);
  expect(box.width, `${label} should be wide enough to tap`).toBeGreaterThanOrEqual(44);
}

async function expectVisibleTargetsTappable(locator: Locator, label: string): Promise<void> {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible()) {
      await expectTappable(item, `${label} ${index + 1}`);
    }
  }
}

test.describe("mobile Borough discovery", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  test("index and borough chapter stay thumb-safe and navigable", async ({ page }) => {
    const errors = watchPageErrors(page);
    const response = await page.goto("/borough");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { name: /London, by the area you drink in/i })).toBeVisible();
    const boroughRows = page.locator(".boroughRow");
    await expect(boroughRows.first()).toBeVisible();
    await expectTappable(boroughRows.first(), "first borough row");
    await expectNoHorizontalOverflow(page);

    await boroughRows.first().locator(".rowListTitleLink").click();
    await expect(page).toHaveURL(/\/borough\/[a-z0-9-]+$/);
    await expect(page.getByRole("heading", { name: /^Pubs in / })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Every list on the chapter is a RowList: the whole row is the target.
    await expectVisibleTargetsTappable(page.locator(".boroughRows .rowListItem").first(), "borough pub row");
    await expectVisibleTargetsTappable(page.locator(".boroughLedgerLink").first(), "borough ledger link");
    await expectVisibleTargetsTappable(page.locator(".boroughChip").first(), "borough story chip");
    await expectVisibleTargetsTappable(page.locator(".boroughHeritageFoot a"), "borough heritage foot link");
    await expectVisibleTargetsTappable(page.locator(".boroughPassportFoot a"), "borough passport link");

    const ledgerLink = page.locator(".boroughLedgerLink").first();
    await expect(ledgerLink).toHaveAttribute("href", /\/ledger\/venue-/);
    await ledgerLink.scrollIntoViewIfNeeded();
    await ledgerLink.click();
    await expect(page).toHaveURL(/\/ledger\/venue-/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    expect(errors).toEqual([]);
  });
});
