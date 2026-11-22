import { expect, test, type Locator, type Page } from "@playwright/test";
import { answerClaimedHandleReads, gotoUnstoredProfile } from "./helpers/authDoubles";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_handle", "mobileqa-viewer");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
      })),
    )
    .toEqual({
      clientWidth: MOBILE_VIEWPORT.width,
      scrollWidth: MOBILE_VIEWPORT.width,
      bodyScrollWidth: MOBILE_VIEWPORT.width,
    });
}

async function expectTapTargetsAtLeast44(locator: Locator, label: string): Promise<void> {
  const count = await locator.count();
  expect(count, `${label} should exist`).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const control = locator.nth(i);
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    expect(box, `${label} #${i + 1} should have a layout box`).not.toBeNull();
    if (!box) continue;
    expect(Math.round(box.width), `${label} #${i + 1} width`).toBeGreaterThanOrEqual(44);
    expect(Math.round(box.height), `${label} #${i + 1} height`).toBeGreaterThanOrEqual(44);
  }
}

test.describe("mobile profile social actions", () => {
  test("visitor profile actions stay thumb-safe without horizontal overflow", async ({ page }) => {
    // Since #3070 only a claimed handle renders a profile, so the visitor
    // reads a stored one.
    await answerClaimedHandleReads(page, (handle) => handle === "mobileqatarget"
      ? { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", handle, name: "Mobile QA Target" }
      : null);
    await gotoUnstoredProfile(page, "/u/mobileqa-target");

    const profile = page.locator(".profilePage");
    await expect(profile).toBeVisible();
    await expect(page.locator(".profileHandle")).toContainText("@mobileqatarget");

    const actions = profile.locator(".profileActions");
    await expect(actions).toBeVisible();
    await expect(actions.getByRole("link", { name: "Sign in to follow" })).toBeVisible();
    await expectTapTargetsAtLeast44(
      actions.locator("a, button").and(page.locator(":visible")),
      "profile action",
    );

    await expectNoHorizontalOverflow(page);
  });

  test("an unclaimed handle offers a thumb-safe claim", async ({ page }) => {
    // Since #3070 an unclaimed handle answers its own page, not a profile.
    await gotoUnstoredProfile(page, "/u/mobileqa-target");
    await expect(page.getByRole("heading", { name: "Nobody has claimed @mobileqatarget" })).toBeVisible();
    await expectTapTargetsAtLeast44(page.getByRole("link", { name: "Claim a handle" }), "claim action");
    await expectNoHorizontalOverflow(page);
  });
});
