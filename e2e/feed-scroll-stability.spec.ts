import { expect, test, type Page } from "@playwright/test";

import { expectStreamedPageSettled } from "./helpers/streamedPage";

// /feed is a legacy alias. Social is canonical, so this file guards the
// redirect and the signed-out shell that users reach after it. The retired
// FeedPageClient is not reachable through a supported browser route.

const MOBILE = { width: 390, height: 844 };

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("canonical Social route", () => {
  test("legacy /feed redirects to /social without mounting the retired feed", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    const response = await page.goto("/feed");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/social$/);
    // /social streams its loading skeleton first. Until React swaps the page
    // in, and while a loaded box renders it again on the client, the hidden
    // segment can sit beside the live page, so a strict read of the title can
    // meet two copies.
    await expectStreamedPageSettled(page);
    await expect(page.locator("h1.screenTitle")).toBeVisible();
    await expect(page.locator(".feedTitle")).toHaveCount(0);
    await expect(page.locator(".feedCard")).toHaveCount(0);
  });

  test("signed-out Social boundary stays within the mobile viewport", async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE);
    const response = await page.goto("/social");
    expect(response?.status()).toBe(200);
    await expectStreamedPageSettled(page);
    await expect(page.locator("h1.screenTitle")).toBeVisible();
    // The read-only London lane, not a wall (captain decision 7, 1 Nov 2026).
    await expect(page.getByRole("heading", { name: "Across London", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in", exact: true }).last()).toHaveAttribute("href", "/login?mode=signin&from=%2Fsocial");
    await expect(page.getByRole("heading", { name: "Your crews", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Find your lot" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
