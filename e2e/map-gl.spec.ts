import { test, expect } from "@playwright/test";

// GPU-present contract. Runs only under the `chromium-gl` project, which launches
// Chromium with SwiftShader (a software GL implementation) so a real WebGL2
// context exists even on a GPU-less CI box. Where smoke.spec.ts asserts
// canvas-OR-fallback (WebGL-agnostic), this spec asserts the *success* half: a
// browser with a working GL stack must paint the MapLibre canvas and NEVER show
// the "Map renderer unavailable" fallback. It is the regression guard for the
// real-browser fallback reports.

test("/map renders the MapLibre canvas with real size and never falls back", async ({
  page,
}) => {
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // The map is a dynamic import (ssr:false) behind a loading shell; the wrapper
  // appears first, then either the canvas or the fallback. Give MapLibre room to
  // construct + acquire its context under parallel load.
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20000 });

  // Success assertion: the MapLibre container's <canvas> exists, is visible, and
  // has non-zero paint area. MapLibre creates the canvas synchronously on a
  // successful construct, so its presence + size is the honest "GL works" signal.
  const canvas = page.locator(".maplibreMap canvas").first();
  await expect(canvas).toBeVisible({ timeout: 20000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // The whole point: with a working GL stack the fallback must never render.
  // Assert it after the canvas is up AND after the component's one silent
  // auto-retry window (1500ms) could have elapsed, so a late fallback can't slip
  // through green.
  await page.waitForTimeout(2000);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect(canvas).toBeVisible();
});
