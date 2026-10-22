import { expect, test } from "@playwright/test";

import { expectMobileMapShellReady } from "./helpers/mobileMapShell";

const HATTON = "venue-1vle947";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`${viewport.name} restored search keeps surrounding pins after the venue closes`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/*", (route) => ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort());
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await page.goto(`/map?q=Hatton&sel=${HATTON}`);
    if (viewport.name === "phone") await expectMobileMapShellReady(page);
    await expect(page.getByRole("heading", { name: "The Sir Christopher Hatton", exact: true })).toBeVisible({ timeout: 30_000 });

    // The former idle query admitted only Hatton, whose pin sat below the
    // venue drawer. The query still narrows search, but nearby pins stay.
    await expect.poll(async () => Number(await page.locator(".mapCanvasWrap").getAttribute("data-venue-count")))
      .toBeGreaterThan(1);
    await expect(page.getByText("Visiting another city?", { exact: true })).toHaveCount(0);

    const close = page.getByRole("button", { name: "Close pub detail", exact: true });
    await expect(async () => {
      await close.click();
      await expect(page.locator("#main")).not.toHaveClass(/detail-open/, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/map\?q=Hatton$/);
    await expect.poll(async () => page.evaluate(() => {
      const probe = (window as Window & {
        __pubmaxPaintedMapTapPoints?: () => Array<{ kind: string; id: string }>;
      }).__pubmaxPaintedMapTapPoints;
      return probe?.().some((point) => point.kind === "cluster" ||
        (point.kind === "pin" && !point.id.startsWith("venue-uk-") && point.id !== "venue-1vle947")) ?? false;
    })).toBe(true);

    await page.waitForTimeout(1_000);
    await expect(page.locator("#main")).not.toHaveClass(/detail-open/);
    await expect(page.getByText("Visiting another city?", { exact: true })).toHaveCount(0);
    await page.reload();
    if (viewport.name === "phone") await expectMobileMapShellReady(page);
    await expect.poll(async () => Number(await page.locator(".mapCanvasWrap").getAttribute("data-venue-count")))
      .toBeGreaterThan(1);
    await expect.poll(async () => page.evaluate(() => {
      const camera = (window as Window & {
        __pubmaxMapCamera?: { read(): { moving: boolean; settling: boolean } };
      }).__pubmaxMapCamera?.read();
      return Boolean(camera && !camera.moving && !camera.settling);
    })).toBe(true);
    await page.waitForTimeout(1_000);
    await expect(page.locator("#main")).not.toHaveClass(/detail-open/);
    await expect(page).toHaveURL(/\/map\?q=Hatton$/);
    await expect(page.getByText("Visiting another city?", { exact: true })).toHaveCount(0);
  });
}

test("a remote typed search takes the camera from Near me", async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/*", (route) => ["GET", "HEAD"].includes(route.request().method())
    ? route.continue()
    : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  // Load the remote matches through a real arrival before comparing them
  // with Near me. Search suggestions alone do not load map venue shards.
  await page.goto("/map?q=Richmond");
  await expect.poll(async () => page.evaluate(() => {
    const camera = (window as Window & {
      __pubmaxMapCamera?: { read(): { center: number[]; moving: boolean; settling: boolean } };
    }).__pubmaxMapCamera?.read();
    return camera && !camera.moving && !camera.settling ? camera.center[0] : 0;
  }), { timeout: 30_000 }).toBeLessThan(-0.2);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByRole("button", { name: /^Map area:/ }).click();
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 51.5074, longitude: -0.1278, accuracy: 10 });
  const useLocation = page.getByRole("button", { name: "Use my location", exact: true });
  await expect(async () => {
    await useLocation.click();
    await expect(page.getByRole("button", { name: "Map area: Near me. Change city", exact: true }))
      .toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText("Showing pubs near you", { exact: true }))
    .toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => page.evaluate(() => {
    const camera = (window as Window & {
      __pubmaxMapCamera?: { read(): { center: number[]; zoom: number; moving: boolean; settling: boolean } };
    }).__pubmaxMapCamera?.read();
    return Boolean(camera && !camera.moving && !camera.settling &&
      Math.abs(camera.center[0]! - (-0.1278)) < 0.001 && camera.zoom >= 13.5);
  })).toBe(true);

  const search = page.getByRole("combobox", { name: "Search pubs", exact: true });
  await search.fill("Richmond");
  await expect(page.getByRole("listbox", { name: "Search suggestions" })
    .getByRole("option").filter({ hasText: "The Prince's Head, Richmond" }))
    .toBeVisible({ timeout: 30_000 });
  await search.press("Escape");
  await page.getByRole("button", { name: "Drink: Pints", exact: true }).focus();

  // Richmond's matches are west of the reader's Trafalgar Square fix.
  await expect.poll(async () => page.evaluate(() => {
    const camera = (window as Window & {
      __pubmaxMapCamera?: { read(): { center: number[]; zoom: number; moving: boolean; settling: boolean } };
    }).__pubmaxMapCamera?.read();
    return camera && !camera.moving && !camera.settling ? camera.center[0] : 0;
  }), { timeout: 15_000 }).toBeLessThan(-0.2);
  await expect(page).toHaveURL(/\/map\?q=Richmond$/);
});
