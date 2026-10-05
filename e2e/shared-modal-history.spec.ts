import { expect, test } from "@playwright/test";

import { expectMapToolbarReady, selectFirstToolbarVenue } from "./helpers/mapToolbar";

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", screenshot: "only-on-failure" });
test.setTimeout(120_000);

for (const finalOpen of [false, true]) {
  test(`browser history ${finalOpen ? "opens" : "closes"} a venue beneath a strict modal and preserves its final state`, async ({ page, context }, testInfo) => {
    await context.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
    });
    await context.route("https://pubmaxx-e2e.supabase.co/**", (route) =>
      route.fulfill({ status: 200, json: {} }),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/map");
    await expectMapToolbarReady(page);
    const search = page.locator(".mapToolbar").getByRole("combobox", { name: "Search pubs" });
    await selectFirstToolbarVenue(page, "The French House");
    const drawer = page.locator(".mapDrawer.right");
    await expect(drawer).toHaveAttribute("aria-hidden", "false");
    if (finalOpen) {
      await page.goBack();
      await expect(drawer).toHaveAttribute("aria-hidden", "true");
    }

    const otherTab = await context.newPage();
    await otherTab.goto("/places");
    // Disposable input to the real cross-tab nudge subscription. No account or
    // shared plan is created, and the actual modal owns focus and inert state.
    await otherTab.evaluate(() => {
      localStorage.setItem("pubmax:identityNudge:pendingAt:v1", String(Date.now()));
      localStorage.setItem("pubmax:identityNudge:pending:v1", "plan");
    });
    await otherTab.close();
    const modal = page.getByRole("dialog", { name: "Keep your nights" });
    await expect(modal).toBeVisible();
    await expect(modal).toBeFocused();

    if (finalOpen) await page.goForward();
    else await page.goBack();
    await expect(drawer).toHaveAttribute("aria-hidden", finalOpen ? "false" : "true");
    await expect(modal).toBeVisible();
    expect(await drawer.evaluate((node) => node.closest("[inert]") !== null)).toBe(true);
    await testInfo.attach("modal-ownership", {
      body: JSON.stringify(await modal.evaluate((node) => ({
        modalInertAncestor: node.closest("[inert]")?.className ?? null,
        activeElement: document.activeElement?.tagName,
        drawerInert: document.querySelector(".mapDrawer.right")?.closest("[inert]")?.className ?? null,
      })), null, 2),
      contentType: "application/json",
    });
    await page.screenshot({ path: testInfo.outputPath(`history-${finalOpen ? "open" : "closed"}-under-modal.png`) });
    const last = modal.getByRole("button", { name: "Not now" });
    await last.focus();
    await page.keyboard.press("Tab");
    await expect(modal.locator('input[type="email"]')).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(last).toBeFocused();
    await last.click();
    await expect(modal).toHaveCount(0);
    await expect(drawer).toHaveAttribute("aria-hidden", finalOpen ? "false" : "true");
    if (finalOpen) {
      expect(await drawer.evaluate((node) => node.closest("[inert]") === null)).toBe(true);
      const close = drawer.getByRole("button", { name: "Close bar detail", exact: true });
      await close.focus();
      await expect(close).toBeFocused();
      await close.click();
      await expect(drawer).toHaveAttribute("aria-hidden", "true");
    } else {
      await expect(drawer).toHaveAttribute("inert", "");
    }
    await search.focus();
    await expect(search).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("map-interactive-after-modal.png") });
  });
}
