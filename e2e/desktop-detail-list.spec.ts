import { expect, test } from "@playwright/test";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

for (const [width, following] of [[1024, false], [1440, false], [1440, true]] as const) {
  test(`${width}: a pub replaces the list and Back restores it, following=${following}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
    });
    await installDeterministicMapBasemap(page);
    await page.goto("/map?max=7");
    const list = page.locator(".mapSplitList");
    await expect(list).toBeVisible();
    await expect(list).toHaveAttribute("aria-busy", "false");
    await list.getByRole("button", { name: "Nearest" }).click();
    const follow = list.getByRole("checkbox", { name: "Search as I move the map" });
    if (!following) await follow.uncheck();
    const scroller = list.locator(".mapSplitListScroll");
    await scroller.evaluate((el) => { el.scrollTop = 350; });
    const row = list.locator(".mapSplitListRow").filter({ visible: true }).nth(6);
    await row.scrollIntoViewIfNeeded();
    const scrollTop = await scroller.evaluate((el) => el.scrollTop);
    const selectedId = await row.getAttribute("data-venue-id");
    await row.click();
    const drawer = page.locator(".mapDrawer.right.open");
    await expect(drawer).toBeVisible();
    await expect(list).toBeHidden();
    await expect(list).toHaveJSProperty("inert", true);
    const canvas = page.locator(".maplibreMap");
    await expect(canvas).toBeVisible();
    await expect.poll(() => canvas.evaluate((element) => !!element.closest("[inert]"))).toBe(false);
    const boxes = await Promise.all([drawer.boundingBox(), page.locator(".mapStage").boundingBox()]);
    expect(boxes[0]!.x).toBe(0);
    expect(boxes[1]!.x).toBeGreaterThanOrEqual(boxes[0]!.width - 1);
    await drawer.getByRole("button", { name: "Back to pubs in this view" }).click();
    await expect(list).toBeVisible();
    await expect(list).toHaveJSProperty("inert", false);
    await page.getByRole("button", { name: "Zoom in", exact: true }).hover();
    await expect(list).toHaveAttribute("aria-busy", "false");
    await expect(list.locator(`[data-venue-id="${selectedId}"]`)).toBeAttached();
    await expect(list.getByRole("button", { name: "Nearest" })).toHaveAttribute("aria-pressed", "true");
    if (following) await expect(follow).toBeChecked();
    else await expect(follow).not.toBeChecked();
    await expect(page).toHaveURL(/max=7/);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeCloseTo(scrollTop, 0);
  });
}

test("the desktop map controls remain usable beside a pub", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  await installDeterministicMapBasemap(page);
  await page.goto("/map");
  const list = page.locator(".mapSplitList");
  await expect(list).toHaveAttribute("aria-busy", "false");
  await list.locator(".mapSplitListRow").first().click();
  const canvas = page.locator(".maplibreMap");
  await expect.poll(() => canvas.evaluate((element) => !!element.closest("[inert]"))).toBe(false);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const drawer = page.locator(".mapDrawer.right.open");
  await expect(drawer).toBeVisible();
  const last = drawer.locator('a[href], button:not([disabled]), summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]').filter({ visible: true }).last();
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(last).not.toBeFocused();
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest(".mapSplitList") === null)).toBe(true);
});
