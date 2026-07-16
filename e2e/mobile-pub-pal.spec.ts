import { expect, test } from "@playwright/test";

test("route-first Pal chooser shows all six companions and restores its five-step draft at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pal");

  await expect(page.getByRole("heading", { name: "First, describe your night." })).toBeVisible();
  await expect(page.getByRole("link", { name: /Describe my night/ })).toHaveAttribute("href", "/map?plan=1");
  await expect(page.getByRole("button", { name: /Meet your Pub Pal/ })).toHaveCount(0);

  await page.evaluate(() => localStorage.setItem("pubmaxx.pub-pal-route-activation.v1", JSON.stringify({ version: 1, activatedAt: new Date().toISOString() })));
  await page.reload();
  await page.getByRole("button", { name: /Meet your Pub Pal/ }).click();
  await expect(page.getByRole("heading", { name: "The grown-up bit first." })).toBeVisible();
  await page.getByRole("checkbox", { name: /I confirm I am 18 or over/ }).check();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("heading", { name: "Who finds you?" })).toBeVisible();

  for (const species of ["Greyhound", "Black Cat", "Fox", "Pigeon", "Badger", "Corgi"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${species}`) })).toBeVisible();
  }
  await page.getByRole("button", { name: /^Pigeon/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Beacon");
  await page.waitForTimeout(300);
  await page.reload();

  await expect(page.getByRole("heading", { name: "Who finds you?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Pigeon/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Beacon");
  const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(layout.width).toBeLessThanOrEqual(layout.viewport);
  await expect(page.locator(".palPortraitCore")).toHaveCSS("animation-name", "none");
});
