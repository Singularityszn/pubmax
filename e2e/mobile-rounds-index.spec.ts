import { expect, test, type Locator, type Page } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(1);
}

async function expectTapTarget(locator: Locator, label: string): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(Math.round(box.width), `${label} width`).toBeGreaterThanOrEqual(44);
  expect(Math.round(box.height), `${label} height`).toBeGreaterThanOrEqual(44);
}

test("mobile Rounds index starts a round and explains link-based joining", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const response = await page.goto("/rounds");
  expect(response?.status()).toBe(200);

  // EmptyState (components/ui/empty-state.tsx) titles with a paragraph, not a
  // heading: the Screen owns the page's one heading.
  await expect(page.locator(".emptyStateTitle", { hasText: "Join with a link" })).toBeVisible();
  await expect(page.getByText(/A round opens from the link/i)).toBeVisible();

  // F18: "Start a round" is a real flow on this page, not a link to a bare map.
  // The starter's submit is the screen's one primary and it needs no account.
  const start = page.getByRole("button", { name: "Start a Round", exact: true });
  await expect(start).toHaveAttribute("data-primary-action", "");
  await expectTapTarget(start, "start round button");
  const handle = page.getByRole("textbox", { name: "Your handle" });
  await expectTapTarget(handle, "handle field");
  await expectNoHorizontalOverflow(page);

  // An empty handle answers in place instead of doing nothing.
  await handle.fill("");
  await start.click();
  await expect(page.locator(".roundStarterError")).toHaveText("Pick a handle to start a Round.");
  await expect(page).toHaveURL(/\/rounds$/);

  await handle.fill("round-starter-e2e");
  await start.click();
  await expect(page).toHaveURL(/\/rounds\/[A-Za-z0-9-]+$/, { timeout: 30_000 });
  await expectNoHorizontalOverflow(page);
});
