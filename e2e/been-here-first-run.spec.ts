import { expect, test } from "@playwright/test";

import { installAuthDoubles } from "./helpers/authDoubles";
import { storeThemeChoice } from "./helpers/themeClock";

for (const theme of ["light", "dark"] as const) {
  test(`the first-run picker clears the dock at 320px in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await installAuthDoubles(page);
    await storeThemeChoice(page, theme);
    await page.goto("/u/you");

    const picker = page.getByRole("region", { name: "Tap the pubs you've been to", exact: true });
    await expect(picker).toBeVisible();
    await picker.scrollIntoViewIfNeeded();
    const dock = page.getByRole("navigation", { name: "Primary", exact: true });
    await expect(dock).toBeVisible();
    await expect(async () => {
      const dockBox = await dock.boundingBox();
      expect(dockBox).not.toBeNull();
      for (const control of [picker.getByRole("heading"), picker.getByRole("button", { name: "Done", exact: true }),
        picker.getByRole("button", { name: "Not now", exact: true })]) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(dockBox!.y);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(320);
      }
    }).toPass();

    const lastPub = picker.getByRole("group", { name: "Pubs to tap" }).getByRole("button").last();
    await lastPub.scrollIntoViewIfNeeded();
    await expect(lastPub).toBeInViewport({ ratio: 1 });
    await lastPub.click();
    await expect(lastPub).toHaveAttribute("aria-pressed", "true");
    await picker.getByRole("button", { name: "Done", exact: true }).click();
    await expect(picker).toHaveCount(0);
  });
}
