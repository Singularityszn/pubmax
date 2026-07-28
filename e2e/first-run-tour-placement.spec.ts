import { expect, test } from "@playwright/test";

test("mobile first-run tour leaves the map centre visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.removeItem("pubmax-tour-v1-done");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  const titles = [
    "PUBMAXXING",
    "Find pints near you",
    "Keep the night",
    "Cheapest tonight",
  ];

  for (const [index, title] of titles.entries()) {
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThan(844 * 0.55);

    const centre = { x: 390 / 2, y: 844 / 2 };
    const coversCentre =
      centre.x >= box!.x &&
      centre.x <= box!.x + box!.width &&
      centre.y >= box!.y &&
      centre.y <= box!.y + box!.height;
    expect(coversCentre).toBe(false);

    const actionNames = [
      index === 0 ? "Skip" : "Back",
      index === titles.length - 1 ? "Get me to a pub" : "Next",
    ];
    for (const name of actionNames) {
      const action = dialog.getByRole("button", { name, exact: true });
      await expect(action).toBeVisible();
      const actionBox = await action.boundingBox();
      expect(actionBox?.height).toBeGreaterThanOrEqual(44);
    }

    if (index < titles.length - 1) {
      await dialog.getByRole("button", { name: "Next", exact: true }).click();
    }
  }
});
