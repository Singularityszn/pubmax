import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { expectFallbackTextClearOfChrome } from "./helpers/mapFallbackClearance";

// No-WebGL contract. Runs only under the `chromium-no-gl` project, which launches
// Chromium with `--disable-webgl --disable-webgl2` so the MapLibre constructor
// gets NO context — exactly the genuinely-WebGL-less browser we owe an honest,
// diagnosable dead end. This spec proves that dead end: the fallback renders, it
// carries a technical detail line, and (because a re-init can't conjure a context
// that doesn't exist) it hides Retry only in this confirmed-no-WebGL case.
//
// Note: the component auto-retries once (1500ms) before ever surfacing the
// fallback, so the timeout below must clear that window.

test("/map surfaces an honest fallback with a detail line when WebGL is disabled", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20000 });

  // The fallback appears only after the silent auto-retry (attempt 2) also fails,
  // so allow generous time for two construct attempts + the 1500ms retry gap.
  const fallback = page.locator(".mapFallback");
  await expect(fallback).toBeVisible({ timeout: 20000 });

  // Honest copy: a confirmed-no-WebGL probe is the only case allowed to claim it.
  await expect(fallback).toContainText(/WebGL/i);
  await expectFallbackTextClearOfChrome(page);

  // The technical diagnostic is present but collapsed by default — calm,
  // honest copy up front, the raw diagnostic only a tap away for a bug report.
  const disclosure = page.locator(".mapFallbackDisclosure");
  await expect(disclosure).toBeVisible();
  await expect(page.locator(".mapFallbackDetail")).toHaveCount(0);
  await disclosure.getByRole("button", { name: "Technical details" }).click();
  await expect(page.locator(".mapFallbackDetail")).toBeVisible();

  // Retry is hidden in the confirmed-no-WebGL case: a re-init can't produce a
  // context this browser refuses to give.
  await expect(page.locator(".mapFallbackRetry")).toHaveCount(0);

  // The canvas must NOT be present — this is the true no-GL path.
  await expect(page.locator(".maplibreMap canvas")).toHaveCount(0);

  // Venue content must survive the dead renderer: the fallback lists real pubs
  // from the slim index (tappable rows) plus the full-directory link, so a
  // no-WebGL browser is never a dead end for the actual product content.
  await expect(page.locator(".mapFallbackBrowse")).toBeVisible();
  await expect
    .poll(async () => page.locator(".mapFallbackVenue").count(), { timeout: 15000 })
    .toBeGreaterThan(0);
  await expect(page.locator(".mapFallbackVenueName").first()).not.toBeEmpty();
  if (process.env.PUBMAX_GATE_Z_SHOTS) {
    const directory = "docs/screenshots/the-local-gate-z";
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: `${directory}/webgl-fallback-390x844-light.png` });
  }
});

// The desktop half of the same card. The search toolbar and the city chip float
// over the map at every desktop width, and a centred card read its heading and
// first lines from behind them. Wait for the chip, because it arrives after
// the card and the card has to clear it once it does.
for (const viewport of [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]) {
  test(`/map fallback heading and message clear the toolbar and city chip at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await page.goto("/map");

    await expect(page.locator(".mapFallback")).toContainText("Map unavailable", {
      timeout: 20_000,
    });
    await expect(page.locator(".mapToolbar")).toBeVisible();
    await expect(page.locator(".citySuggestBanner")).toBeVisible({ timeout: 15_000 });
    await expectFallbackTextClearOfChrome(page);
  });
}

// Once the reader dismisses the chip, the London status strip takes the slot
// under the toolbar, and the card has to clear the strip's pill as well.
test("/map fallback heading and message clear the London status strip at 1440x900", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.route("**/api/citymcp/status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-08-03T08:00:00.000Z",
        weather: null,
        tubeLines: [{ line: "Central", status: "Severe delays" }],
        signals: [],
      }),
    }),
  );
  await page.goto("/map");

  await expect(page.locator(".mapFallback")).toContainText("Map unavailable", {
    timeout: 20_000,
  });
  await page
    .getByRole("button", { name: "Dismiss city suggestion" })
    .first()
    .click({ timeout: 15_000 });
  await expect(page.locator(".citySuggestBanner")).toHaveCount(0);
  await expect(page.locator(".cityStatusStack")).toBeVisible({ timeout: 20_000 });
  await expectFallbackTextClearOfChrome(page);
});
