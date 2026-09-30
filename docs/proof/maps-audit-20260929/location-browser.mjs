import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { initialFilters } from "../../../lib/venues.ts";
import { nearMeLocationMessage } from "../../../lib/nearMeLocation.ts";
import { UI_UX_CHROMIUM_ARGS } from "../../../scripts/lib/uiUxBattleTestBrowser.mjs";

// Run against this branch's private-port production server with node --import tsx.
const origin = process.argv[2];
const diagnosticOnly = process.argv.includes("--diagnostic");
const timeoutFlag = process.argv.find((argument) => argument.startsWith("--timeout-ms="));
const timeoutMs = Number(timeoutFlag?.split("=")[1] ?? 110_000);
assert(origin, "Pass the private-port production origin");
assert(Number.isInteger(timeoutMs) && timeoutMs >= 10_000 && timeoutMs <= 150_000, "Proof timeout must be 10-150 seconds");
const rows = JSON.parse(readFileSync("public/data/venues_slim.core.json", "utf8")).rows;
const deadline = Date.now() + timeoutMs;
const browser = await chromium.launch({ headless: true, args: UI_UX_CHROMIUM_ARGS, timeout: Math.min(timeoutMs, 15_000) });
const timeout = setTimeout(() => {
  console.error(`Native location proof exceeded ${timeoutMs}ms; closing owned browser.`);
  void browser.close();
}, Math.max(1, deadline - Date.now()));
const fix = { latitude: 51.515, longitude: -0.09, accuracy: 25 };
const oldView = { center: [-0.21, 51.54], zoom: 14, pitch: 0, bearing: 0 };
const output = [];

try {
  for (const state of ["granted", "denied", "prompt"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      geolocation: fix,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send("Target.getTargetInfo");
    assert(targetInfo.browserContextId, "Missing isolated browser context ID");
    await cdp.send("Browser.setPermission", {
      browserContextId: targetInfo.browserContextId,
      origin,
      permission: { name: "geolocation" },
      setting: state,
    });
    await page.addInitScript(({ seedRows, viewport, filters }) => {
      const now = Date.now();
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:first-pins-seen:v1", "1");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      localStorage.setItem("pubmax:map-chosen-area:v1", JSON.stringify({
        cityId: "london", kind: "near-me", label: "Near me", slug: "near-me",
      }));
      localStorage.setItem("pubmax:map-opening-location:v1", JSON.stringify({
        lat: 51.54, lng: -0.21, savedAt: now - 86_400_000,
      }));
      localStorage.setItem("map-resume:v1:london", JSON.stringify({
        version: 1, cityId: "london", savedAt: now - 6 * 86_400_000,
        viewport, rows: seedRows,
      }));
      localStorage.setItem("pubmaxx.mobile-map-session.v1", JSON.stringify({
        version: 1, cityId: "london", savedAt: new Date(now - 6 * 86_400_000).toISOString(),
        viewport, filters, nightArea: null, selectedVenueId: null, openSheet: null,
      }));
      window.__locationBrowserProof = { requests: [], watches: [] };
      const geo = navigator.geolocation;
      const request = geo.getCurrentPosition.bind(geo);
      const watch = geo.watchPosition.bind(geo);
      // Count native calls while retaining Chromium's actual permission result.
      Object.defineProperty(geo, "getCurrentPosition", { value(...args) {
        window.__locationBrowserProof.requests.push(performance.now());
        return request(...args);
      } });
      Object.defineProperty(geo, "watchPosition", { value(...args) {
        window.__locationBrowserProof.watches.push(performance.now());
        return watch(...args);
      } });
    }, { seedRows: rows, viewport: oldView, filters: initialFilters });
    assert.equal((await page.goto(`${origin}/map`))?.status(), 200);
    assert.equal(await page.evaluate(async () =>
      (await navigator.permissions.query({ name: "geolocation" })).state,
    ), state, "Permission override did not reach the tested context");
    await page.waitForFunction(() => Boolean(
      window.__pubmaxMapCamera && window.__pubmaxPaintedMapTapPoints?.().length,
    ), null, { timeout: 60_000 });
    if (diagnosticOnly) {
      await page.waitForTimeout(5_000);
      const diagnostic = await page.evaluate(async () => ({
        permission: (await navigator.permissions.query({ name: "geolocation" })).state,
        ...window.__locationBrowserProof,
        href: location.href,
        chosenArea: localStorage.getItem("pubmax:map-chosen-area:v1"),
        saved: localStorage.getItem("pubmax:map-opening-location:v1"),
        camera: window.__pubmaxMapCamera?.read(),
        dot: window.__pubmaxMapReaderPosition?.read(),
        tappableMarks: window.__pubmaxPaintedMapTapPoints?.().length,
      }));
      writeFileSync("docs/proof/maps-audit-20260929/location-browser-diagnostic.json", JSON.stringify({ diagnostic, errors }, null, 2) + "\n");
      await page.screenshot({ path: "docs/proof/maps-audit-20260929/location-browser-diagnostic.png" });
      console.log(JSON.stringify(diagnostic, null, 2));
      break;
    }
    if (state === "granted") {
      await page.waitForFunction(({ latitude, longitude }) => {
        const raw = localStorage.getItem("pubmax:map-opening-location:v1");
        const saved = raw ? JSON.parse(raw) : null;
        const dot = window.__pubmaxMapReaderPosition?.read();
        return saved?.lat === latitude && saved?.lng === longitude &&
          dot?.written?.[0] === longitude && dot?.written?.[1] === latitude;
      }, fix, { timeout: 45_000 });
    }
    await page.waitForFunction(() => {
      const camera = window.__pubmaxMapCamera?.read();
      return camera && !camera.moving;
    }, null, { timeout: 30_000 });
    // Refused cases need time for the venue-index-driven resume effect too.
    await page.waitForTimeout(2_000);
    const reading = await page.evaluate(async () => ({
      permission: (await navigator.permissions.query({ name: "geolocation" })).state,
      ...window.__locationBrowserProof,
      saved: JSON.parse(localStorage.getItem("pubmax:map-opening-location:v1") ?? "null"),
      camera: window.__pubmaxMapCamera.read(),
      dot: window.__pubmaxMapReaderPosition?.read() ?? null,
      tappableMarks: window.__pubmaxPaintedMapTapPoints().length,
    }));
    assert.equal(reading.permission, state);
    assert(reading.tappableMarks > 0, "No tappable map marks");
    assert.deepEqual(errors, [], "Uncaught browser errors");
    if (state === "granted") {
      assert(reading.requests.length > 0, "Remembered Near me made no native request");
      assert(reading.watches.length > 0, "Reader dot made no native watch");
      assert.equal(reading.saved.lat, fix.latitude);
      assert.equal(reading.saved.lng, fix.longitude);
      assert(Date.now() - reading.saved.savedAt < 30 * 60 * 1000);
      assert(reading.dot.hasSource && reading.dot.hasCoreLayer && reading.dot.hasAccuracyLayer);
      assert(reading.dot.rendered, "Reader dot reached its source but did not render");
      assert(Math.abs(reading.dot.rendered[0] - fix.longitude) < 0.0003);
      assert(Math.abs(reading.dot.rendered[1] - fix.latitude) < 0.0003);
      assert(Math.abs(reading.camera.center[0] - fix.longitude) < 0.04);
      assert(Math.abs(reading.camera.center[1] - fix.latitude) < 0.025);
    } else {
      assert.equal(reading.requests.length, 0, "Automatic request without a grant");
      assert.equal(reading.watches.length, 0, "Automatic watch without a grant");
      assert.equal(reading.saved, null, "Expired remembered fix retained");
      assert(Math.abs(reading.camera.center[0] - oldView.center[0]) < 0.00001);
      assert(Math.abs(reading.camera.center[1] - oldView.center[1]) < 0.00001);
    }
    await page.screenshot({ path: `docs/proof/maps-audit-20260929/location-${state}.png` });
    let tapDenial = null;
    if (state === "denied") {
      await page.locator(".citySwitcher--mobile .citySwitcherTrigger").click();
      await page.getByRole("button", { name: "This area", exact: true }).click();
      const chooser = page.locator('.mobileSheetPortal[data-sheet-kind="choose-area"]');
      await chooser.getByRole("button", { name: "Near me", exact: true }).click();
      const refusal = nearMeLocationMessage("denied");
      await page.getByText(refusal, { exact: true }).first().waitFor({ state: "visible", timeout: 15_000 });
      tapDenial = await page.evaluate(() => ({
        requests: window.__locationBrowserProof.requests.length,
        tappableMarks: window.__pubmaxPaintedMapTapPoints().length,
      }));
      assert(tapDenial.requests > 0, "Explicit Near me did not request native location");
      assert(tapDenial.tappableMarks > 0, "Denial left the map without tappable marks");
      tapDenial.message = refusal;
      await page.screenshot({ path: "docs/proof/maps-audit-20260929/location-denied-tap.png" });
    }
    assert.deepEqual(errors, [], "Uncaught browser errors after the explicit denial");
    output.push({ state, reading, tapDenial, errors });
    console.log(`${state}: native permission and rendered-map checks passed`);
    writeFileSync("docs/proof/maps-audit-20260929/location-browser-progress.json", JSON.stringify({ origin, fix, oldView, completed: output }, null, 2) + "\n");
    await context.close();
  }
  if (!diagnosticOnly) {
    writeFileSync("docs/proof/maps-audit-20260929/location-browser.json", JSON.stringify({ origin, fix, oldView, output }, null, 2) + "\n");
    console.log(JSON.stringify(output.map(({ state, reading }) => ({
      state, requests: reading.requests.length, watches: reading.watches.length,
      tappableMarks: reading.tappableMarks, center: reading.camera.center,
    })), null, 2));
  }
} finally {
  clearTimeout(timeout);
  await browser.close();
}
