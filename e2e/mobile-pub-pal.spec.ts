import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { PAL_ONBOARDING_SPECIES } from "../lib/pubPal";

// The chooser offers one button per onboarding species, so the spec reads the
// closed list rather than restating it: adding the Circuit Robin to
// PAL_ONBOARDING_SPECIES must not leave a browser test describing six.
const SPECIES_TITLES: Record<(typeof PAL_ONBOARDING_SPECIES)[number], string> = {
  robin: "Circuit Robin",
  greyhound: "Greyhound",
  cat: "Black Cat",
  fox: "Fox",
  pigeon: "Pigeon",
  badger: "Badger",
  corgi: "Corgi",
};

test("route-first Pal chooser shows every companion and restores its five-step draft at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pal");

  // The Pal is the front door (#1280): the meeting screen opens with its one
  // primary action and no route-activation gate in front of it.
  await expect(page.getByRole("heading", { name: "Choose your Pub Pal." })).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveCount(1);
  // `Meet your Pub Pal` is painted on the SERVER, so it is tappable before
  // React attaches and Playwright's actionability check passes on a tap that is
  // then dropped with nothing on screen saying so (#1464). Retry the TAP rather
  // than waiting harder on the step behind it.
  const adultHeading = page.getByRole("heading", { name: "The grown-up bit first." });
  await expect(async () => {
    await page.getByRole("button", { name: /Meet your Pub Pal/ }).click();
    await expect(adultHeading).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("checkbox", { name: /18 or over/ }).check();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("heading", { name: "Choose a Pal and name." })).toBeVisible();

  for (const species of PAL_ONBOARDING_SPECIES) {
    await expect(page.getByRole("button", { name: new RegExp(`^${SPECIES_TITLES[species]}`) })).toBeVisible();
  }
  if (process.env.PUBMAX_GATE_Z_SHOTS) {
    const directory = "docs/screenshots/the-local-gate-z";
    await mkdir(directory, { recursive: true });
    await page.getByRole("button", { name: /^Greyhound/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${directory}/pal-cast-320x568-light.png` });
  }
  await page.getByRole("button", { name: /^Pigeon/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Beacon");
  await page.waitForTimeout(300);
  await page.reload();

  await expect(page.getByRole("heading", { name: "Choose a Pal and name." })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Pigeon/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Beacon");
  const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(layout.width).toBeLessThanOrEqual(layout.viewport);
  await expect(page.locator(".palPortraitCore")).toHaveCSS("animation-name", "none");
});
