import { expect, test } from "@playwright/test";

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
