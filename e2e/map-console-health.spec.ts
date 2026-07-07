import { test, expect, type ConsoleMessage } from "@playwright/test";

// Map console-health regression (review issue #5). Runs under the `chromium-gl`
// project (SwiftShader software WebGL2) so a real GL context exists and the map
// genuinely constructs — the only condition under which the style-load /
// layer-mutation races this guards against can actually fire. It complements
// map-gl.spec.ts (which asserts the canvas paints): this one asserts the SCENE
// stays healthy across repeated /map↔/feed navigation, failing on any critical
// console error or pageerror.
//
// The specific regressions it guards:
//   • "Style is not done loading" — a source/layer mutation (setData/setFilter/
//     setPaintProperty/addLayer) landing while a style is mid-load (initial load
//     or a theme setStyle({diff:false}) swap window).
//   • "Maximum call stack size exceeded" — pathological re-entrancy on repeated
//     mount/unmount of the map component across navigation.
//
// Benign console noise is allow-listed EXPLICITLY (not suppressed wholesale) so a
// genuinely new error still fails the test:
//   • tile/network fetch aborts — MapLibre aborts in-flight tile requests when
//     the component unmounts on navigation; these surface as failed/aborted
//     fetches and are expected churn, not a scene fault.
//   • [pubmap] diagnostics — the component's own instrumentation logs.
//   • favicon 404s — unrelated to the map.
//
// The map's own diagnostic prefix + expected navigation/tile churn. A message is
// benign only if it matches one of these; everything else is treated as critical.
const BENIGN_PATTERNS: RegExp[] = [
  /\[pubmap\]/i, // component diagnostics (kind:"tiles"/"style" notices etc.)
  /favicon/i, // /favicon.ico 404s, unrelated to the map
  /Failed to load resource/i, // aborted tile/style fetches on unmount navigation
  /net::ERR_ABORTED/i, // MapLibre aborting in-flight tile requests on teardown
  /the server responded with a status of 404/i, // tile/sprite 404 on style fallback
  /AbortError/i, // fetch abort on navigation teardown
];

// Errors we must NEVER tolerate regardless of the allow-list above.
const CRITICAL_PATTERNS: RegExp[] = [
  /Style is not done loading/i,
  /Maximum call stack size exceeded/i,
];

function isCritical(text: string): boolean {
  if (CRITICAL_PATTERNS.some((re) => re.test(text))) return true;
  return !BENIGN_PATTERNS.some((re) => re.test(text));
}

test("/map stays console-healthy across repeated /map↔/feed navigation", async ({
  page,
}) => {
  // Two full round-trips plus tile settling exceeds the 30s project default.
  test.setTimeout(90_000);

  const critical: string[] = [];
  const record = (text: string) => {
    if (isCritical(text)) critical.push(text);
  };

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") record(msg.text());
  });
  page.on("pageerror", (err) => record(err.message));

  // Initial load: the map must construct and paint a real canvas.
  const first = await page.goto("/map");
  expect(first?.status()).toBe(200);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
  const canvas = page.locator(".maplibreMap canvas").first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // Let the style settle (buildScene runs on style.load) so a mutation racing
  // the initial load would already have thrown by now.
  await page.waitForTimeout(2_000);

  // Two full round-trips. Each remount reconstructs the map and re-runs the
  // style-load → buildScene path; the unmount aborts tiles and tears down
  // listeners. This is the churn that surfaces both target regressions.
  for (let i = 0; i < 2; i++) {
    const feed = await page.goto("/feed");
    expect(feed?.status()).toBe(200);
    await page.waitForTimeout(1_000);

    const map = await page.goto("/map");
    expect(map?.status()).toBe(200);
    await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".maplibreMap canvas").first()).toBeVisible({
      timeout: 20_000,
    });
    // Give buildScene + any queued post-build mutations time to flush.
    await page.waitForTimeout(2_000);
  }

  // The map must still be up and no critical error may have surfaced.
  await expect(page.locator(".maplibreMap canvas").first()).toBeVisible();
  await expect(page.locator(".mapFallback")).toHaveCount(0);

  expect(
    critical,
    `Critical map console errors:\n${critical.join("\n")}`,
  ).toEqual([]);
});
