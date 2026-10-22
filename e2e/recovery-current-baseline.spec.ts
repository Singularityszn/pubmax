import { expect, test, type Page } from "@playwright/test";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

// NEW VERIFICATION. These drivers reconstruct coverage after raw evidence loss.
const root = "/Users/karanmanoharan/.codex/visualizations/2026/10/09/01a1221b-f805-78e1-82c3-4eeb27d73308/pr2078-reverification-20261011";
const fixture = readFileSync(`${root}/historical-reference/public-status-fixture.json`, "utf8");
const historical = JSON.parse(readFileSync(`${root}/historical-reference/consumer-receipt.json`, "utf8"));
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

async function setup(page: Page, theme: "light" | "dark", width: number) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
  await installDeterministicMapBasemap(page);
  await page.addInitScript(choice => {
    localStorage.setItem("pubmax-theme", choice);
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmax:analytics-consent:v1", "denied");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  }, theme);
  await page.route("**/api/citymcp/status**", async route => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ status: 200, contentType: "application/json", body: fixture });
  });
}

async function ready(page: Page, theme: "light" | "dark") {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => {
    const camera = (window as any).__pubmaxMapCamera?.read();
    return !!camera && !camera.moving && !camera.settling;
  }), { timeout: 45_000 }).toBe(true);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    (window as any).__pubmaxPaintedMapTapPoints?.().length ?? 0
  ), { timeout: 45_000 }).toBeGreaterThan(0);
  await expect(page.locator(".cityStatusBannerCopy")).toHaveCount(0);
  await expect(page.locator(".cityStatusSignalSheet")).toHaveCount(0);
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [390, 768, 1440]) {
    test(`Recovery unrelated fresh and returning map ${width}px ${theme}`, async ({ page }) => {
      test.setTimeout(120_000);
      await setup(page, theme, width);
      await page.goto("/map");
      await ready(page, theme);
      expect(await page.evaluate(() => localStorage.getItem("pubmaxx:analytics-consent:v1"))).toBe("denied");
      await page.screenshot({ path: `${root}/raw/keyless-final-cohort/fresh-${width}-${theme}.png` });
      // The phone map does not mount SignInButton. The normal /tonight route does.
      await page.goto("/tonight");
      await expect(page.locator('[data-auth-resolved="true"][data-auth-configured="false"]')).toHaveCount(1);
      await page.goto("/map");
      await ready(page, theme);
      await page.screenshot({ path: `${root}/raw/keyless-final-cohort/returning-${width}-${theme}.png` });
    });
  }

  test(`Recovery matching saved initial tablet ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    expect(hash(fixture)).toBe(historical.fixture_sha256);
    const baseline = historical.screenshots.find((s: any) => s.theme === theme);
    expect(hash(readFileSync(`${root}/historical-reference/${baseline.path}`))).toBe(baseline.sha256);
    await setup(page, theme, 768);
    const statusRead = page.waitForResponse("**/api/citymcp/status**");
    const transitRead = page.waitForResponse("**/data/tfl_lines.json", { timeout: 45_000 });
    await page.goto("/map");
    const status = await statusRead;
    expect(status.status()).toBe(200);
    expect(hash(await status.body())).toBe(historical.fixture_sha256);
    await ready(page, theme);
    const transit = await transitRead;
    expect(transit.status()).toBe(200);
    await transit.finished();
    const state = await page.evaluate(() => ({
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      theme: document.documentElement.dataset.theme,
      colorSchemeDark: matchMedia("(prefers-color-scheme: dark)").matches,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      scale: visualViewport?.scale,
      consent: localStorage.getItem("pubmaxx:analytics-consent:v1"),
      priorConsentAlias: localStorage.getItem("pubmax:analytics-consent:v1"),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      userAgent: navigator.userAgent,
      camera: (window as any).__pubmaxMapCamera.read(),
      area: [...document.querySelectorAll(".citySwitcherTrigger")]
        .filter(e => e.getBoundingClientRect().width > 0).map(e => e.getAttribute("aria-label")),
      headlineCount: document.querySelectorAll(".cityStatusBannerCopy").length,
    }));
    expect(state.width).toBe(768);
    expect(state.height).toBe(900);
    for (const k of ["dpr", "theme", "colorSchemeDark", "reducedMotion", "scale", "timeZone"] as const) {
      expect(state[k]).toBe(baseline.dom[k]);
    }
    expect(state.consent).toBe("denied");
    expect(state.priorConsentAlias).toBe("denied");
    expect(state.area).toEqual(baseline.dom.area);
    for (const k of ["bearing", "pitch", "zoom"] as const) expect(state.camera[k]).toBeCloseTo(baseline.dom.camera[k], 8);
    for (const i of [0, 1]) expect(state.camera.center[i]).toBeCloseTo(baseline.dom.camera.center[i], 8);
    expect(state.camera.moving).toBe(false);
    expect(state.camera.settling).toBe(false);
    expect(state.headlineCount).toBe(0);
    const path = `${root}/raw/keyless-final-cohort/current-5cb-tablet-${theme}.json`;
    writeFileSync(path, JSON.stringify({ type: "NEW VERIFICATION", source: "5cb5008de349c0b430daba7ce6e5ef0b86207b5e", state,
      historicalSource: historical.baseline_source, historicalHeadlineVisible: false,
      historicalBuildExit: historical.npm_build_exit, historicalPeak: historical.continuous_build_reserve_and_transient_peak }, null, 2));
    await testInfo.attach("saved-tablet-comparison", { path, contentType: "application/json" });
    await page.screenshot({ path: `${root}/raw/keyless-final-cohort/current-5cb-tablet-${theme}.png` });
  });
}
