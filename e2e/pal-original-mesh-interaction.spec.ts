import { expect, test } from "@playwright/test";
import { canvas, capture, evidence, fixture, portrait, ready } from "./helpers/originalMeshAcceptance";

test("the owned original Robin paints and responds to arrows and Home", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
  await page.clock.install();
  const fx = await fixture(page, testInfo.project.use.baseURL!);
  const seen = capture(page);
  await evidence(page, testInfo, seen, fx, async () => {
    await page.goto("/pal");
    await ready(page, seen);
    const model = portrait(page).getByRole("img", { name: /Robin in 3D/ });
    await expect(model).toBeVisible();
    const picture = canvas(page);
    await model.focus();
    // Fast-forward to a fixed pose beyond this test's remaining wall time.
    // A short offset can pass before the browser receives pauseAt.
    await page.clock.pauseAt(await page.evaluate((timeout) => Date.now() + timeout, testInfo.timeout));
    const front = await picture.screenshot({ path: testInfo.outputPath("robin-front.png") });
    await page.keyboard.press("ArrowRight");
    const right = await picture.screenshot({ path: testInfo.outputPath("robin-right.png") });
    expect(right.equals(front), "ArrowRight changes the actual rendered Robin").toBe(false);
    await page.keyboard.press("Home");
    const reset = await picture.screenshot({ path: testInfo.outputPath("robin-home.png") });
    expect(reset.equals(front), "Home restores the original yaw at the same pose time").toBe(true);
    await page.keyboard.press("ArrowLeft");
    expect((await picture.screenshot()).equals(front), "ArrowLeft also changes the actual rendered Robin").toBe(false);
    await page.keyboard.press("Home");
    expect((await picture.screenshot()).equals(front)).toBe(true);
    await expect(model).toBeFocused();
  });
});
