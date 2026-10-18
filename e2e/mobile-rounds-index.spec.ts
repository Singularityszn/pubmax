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

  // The quiet secondary from the launch table, in plain words.
  const openCode = page.getByText("Open a round code", { exact: true });
  await expect(openCode).toBeVisible();

  // F18: "Start a round" is a real flow on this page, not a link to a bare map.
  // The starter's submit is the screen's one primary and it needs no account.
  const start = page.getByRole("button", { name: "Start a round", exact: true });
  await expect(start).toHaveAttribute("data-primary-action", "");
  await expectTapTarget(start, "start round button");
  const handle = page.getByRole("textbox", { name: "Your handle" });
  await expectTapTarget(handle, "handle field");
  await expectNoHorizontalOverflow(page);

  // A code read out loud opens the Round without editing a URL; a short one
  // answers in place.
  await openCode.click();
  const code = page.getByRole("textbox", { name: "Round code" });
  const openRound = page.getByRole("button", { name: "Open", exact: true });
  await expectTapTarget(code, "round code field");
  await expectTapTarget(openRound, "open round button");
  await code.fill("ab1");
  await openRound.click();
  await expect(page.locator("#round-code-join-error")).toHaveText("A Round code is 6 letters and numbers.");
  await expect(page).toHaveURL(/\/rounds$/);

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
