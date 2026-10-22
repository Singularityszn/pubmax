import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });
for (const chooseNewFocus of [false, true]) {
test(chooseNewFocus ? "deferred drawer return respects later keyboard focus" : "deferred drawer return restores stranded focus", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  let releaseToolbar = () => {};
  const heldToolbar = new Promise<void>((resolve) => { releaseToolbar = resolve; });
  let intercepted = false;
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document") documentRequests += 1;
  });
  await page.route("**/*.js*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    if (source.includes("mapToolbarSearch")) {
      intercepted = true;
      console.log("Held toolbar chunk", new URL(route.request().url()).pathname);
      await heldToolbar;
    }
    await route.fulfill({ response });
  });
  try {
    await page.goto("/map/glasgow?sel=venue-glw-q7pz7s", { waitUntil: "domcontentloaded" });
    const drawer = page.locator(".mapDrawer.right.open");
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => intercepted).toBe(true);
    await expect(page.locator("#mapSearchInput")).toHaveCount(0);
    const close = drawer.getByRole("button", { name: /Close/ });
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBeNull();
    const command = page.getByRole("button", { name: "Open command palette", exact: true });
    await expect(command).toBeVisible();
    if (chooseNewFocus) {
      for (let index = 0; index < 80; index += 1) {
        if (await command.evaluate((node) => node === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      await expect(command).toBeFocused();
    }
    releaseToolbar();
    await expect(page.locator("#mapSearchInput")).toBeVisible({ timeout: 30_000 });
    console.log("Focus after toolbar release", await page.evaluate(() => ({
      id: document.activeElement?.id,
      className: document.activeElement?.className,
    })), "documentRequests", documentRequests);
    expect(documentRequests).toBe(1);
    if (chooseNewFocus) await expect(command).toBeFocused();
    else await expect(page.locator("#mapSearchInput")).toBeFocused();
  } finally {
    releaseToolbar();
  }
});
}
