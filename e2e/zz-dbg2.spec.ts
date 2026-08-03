import { expect, test } from "@playwright/test";
test.setTimeout(90_000);
test.use({ viewport: { width: 390, height: 844 } });
test("dbg", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.goto("/map");
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 60_000 });
  await page.getByRole("button", { name: "More map controls" }).first().click();
  await expect(page.locator(".mobileSheetPortal")).toBeVisible();
  console.log("stamp-layers", await page.evaluate(() => (history.state || {}).pubmaxSurfaceDepth ?? null));
  console.log("homeStyle", JSON.stringify(await page.locator(".surfaceNavHome").evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopWidth, bg: s.backgroundColor, box: s.boxShadow, w: s.width, h: s.height };
  })));
  await page.getByRole("tab", { name: "Layers" }).click();
  const listBtns = await page.getByRole("button", { name: "List view", exact: false }).count();
  console.log("listButtons", listBtns);
  await page.locator(".mobileSharedSheetBody").getByRole("button", { name: "List view" }).click();
  await page.waitForTimeout(1200);
  console.log("stamp-list", await page.evaluate(() => (history.state || {}).pubmaxSurfaceDepth ?? null));
  console.log("listBack", await page.locator(".mapVenueListPanel .surfaceNavBack").getAttribute("aria-label").catch(() => "NONE"));
});
