import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`keeps Pub Pal onboarding clear at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/pal");
    await page.getByRole("button", { name: "Meet your Pub Pal" }).click();

    const preview = page.locator(".palOnboardingPreview");
    const panel = page.locator(".palOnboardingPanel");
    const actions = page.locator(".palOnboardingActions");
    const [previewBox, panelBox, actionsBox] = await Promise.all([
      preview.boundingBox(),
      panel.boundingBox(),
      actions.boundingBox(),
    ]);

    expect(previewBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect((previewBox?.y ?? 0) + (previewBox?.height ?? 0)).toBeLessThanOrEqual(
      (panelBox?.y ?? 0) + 1,
    );
    expect((actionsBox?.x ?? -1) + (actionsBox?.width ?? 0)).toBeLessThanOrEqual(
      viewport.width,
    );
    await expect(page.locator(".palCharacter-hound")).toBeVisible();
    expect(await page.evaluate(() => document.body.scrollWidth)).toBe(viewport.width);
  });
}
