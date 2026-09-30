import { expect, test } from "@playwright/test";

for (const componentInert of [false, true]) {
  test(`strict modal retains component inert=${componentInert} after asynchronous mutation`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:identityNudge:pending:v1", "plan");
      localStorage.setItem("pubmax:identityNudge:pendingAt:v1", String(Date.now()));
    });
    await page.goto("/plan");
    const nav = page.getByRole("navigation", { name: "Primary" });
    const background = page.locator("a.skipLink");
    const map = nav.getByRole("link", { name: "Map" });
    await expect(map).toBeVisible();
    await map.focus();
    await page.keyboard.press("Shift");
    const dialog = page.getByRole("dialog", { name: "Keep your nights" });
    await expect(dialog).toBeVisible();
    await expect(background).toHaveAttribute("inert", "");
    // Inject a component-owned attribute update while the real modal owns this node.
    await background.evaluate((node, value) => { (node as HTMLElement).inert = value; }, componentInert);
    await expect(background).toHaveAttribute("inert", "");
    await background.focus();
    await expect(background).not.toBeFocused();
    await dialog.getByRole("button", { name: "Not now" }).focus();
    await page.keyboard.press("Tab");
    await expect(dialog.locator("input[type=email]")).toBeFocused();
    await page.screenshot({ path: info.outputPath("modal-blocks-background.png") });
    await dialog.getByRole("button", { name: "Not now" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => background.evaluate(node => (node as HTMLElement).inert)).toBe(componentInert);
    if (!componentInert) {
      await map.click();
      await expect(page).toHaveURL(/\/map/);
    } else {
      await background.focus();
      await expect(background).not.toBeFocused();
    }
    await page.screenshot({ path: info.outputPath("component-state-after-close.png") });
  });
}

test("closing a strict modal keeps the underlying map sheet blocking background until it closes", async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  });
  await page.goto("/map?sel=venue-xjf3n0");
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(sheet).toBeVisible();
  const background = page.locator("a.skipLink");
  await expect(background).toHaveAttribute("inert", "");
  await page.evaluate(() => {
    localStorage.setItem("pubmax:identityNudge:pending:v1", "plan");
    localStorage.setItem("pubmax:identityNudge:pendingAt:v1", String(Date.now()));
    window.dispatchEvent(new StorageEvent("storage", { key: "pubmax:identityNudge:pending:v1" }));
  });
  await page.keyboard.press("Shift");
  const dialog = page.getByRole("dialog",{ name: "Keep your nights" });
  await expect(dialog).toBeVisible();
  await background.evaluate(node => { (node as HTMLElement).inert = false; });
  await expect(background).toHaveAttribute("inert", "");
  await page.screenshot({ path: info.outputPath("overlapping-modals.png") });
  await dialog.getByRole("button",{ name: "Not now" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(background).toHaveAttribute("inert", "");
  await background.focus();
  await expect(background).not.toBeFocused();
  await sheet.locator(".surfaceNavHome").click();
  await expect(sheet).toHaveCount(0);
  await expect(background).not.toHaveAttribute("inert", "");
});
