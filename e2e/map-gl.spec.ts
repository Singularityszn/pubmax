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
  // This test deliberately waits out the full tile-timeout window (see the
  // second assertion block), which alone exceeds the 30s project default.
  test.setTimeout(60_000);
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

  // Tile-timeout regression guard (the "Map tiles unavailable" report). The
  // canvas can construct fine while the *style* silently fails to load its
  // tiles: PubMapCanvas waits STYLE_LOAD_TIMEOUT_MS (8s), swaps to the CARTO
  // fallback style, then waits another 8s before surfacing the kind:"tiles"
  // .mapFallback. A short wait (above) passes green even if that's about to
  // fire — and a CSP that blocks the CARTO fallback (basemaps.cartocdn.com /
  // tiles.basemaps.cartocdn.com must be in connect-src) guarantees it fires.
  // Wait out the full 8s+8s window so a tile/CSP failure can't hide behind an
  // early green. Either OpenFreeMap loads directly, or the CARTO fallback does;
  // either way the fallback must never appear and the canvas must stay up.
  await page.waitForTimeout(18_000);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect(canvas).toBeVisible();
});
