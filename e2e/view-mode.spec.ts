import { expect, test } from "@playwright/test";

// Lock-In / Ledger was intentionally retired from the global product chrome.
// A stale preference may still exist on returning devices, but it must not
// replace the stable five-destination mobile navigation or turn Moment into a
// destination. The public Ledger route remains available from venue context.
test("legacy view-mode state cannot replace the current mobile navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax-mode", "ledger");
    window.localStorage.setItem("pubmax-legacy", "1");
  });
  await page.goto("/feed");

  const nav = page.getByRole("navigation", { name: "Primary" });
  for (const label of ["Explore", "Tonight", "Plan", "Social", "You"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  // The bar holds destinations only: five tabs and nothing else (captain,
  // 1 Nov 2026). Compose is an action, and the floating create button is gone.
  await expect(nav.getByRole("link")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Create" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /ledger|lock-in/i })).toHaveCount(0);

  // /feed is a Social alias, so the Social tab is the one lit destination.
  const destinations = await nav.locator("a[aria-current='page']").allTextContents();
  expect(destinations).toEqual(["Social"]);
});
