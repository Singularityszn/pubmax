import { expect, test } from "@playwright/test";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { uiUxChromiumProjectUse } from "../scripts/lib/uiUxBattleTestBrowser.mjs";
test.use(uiUxChromiumProjectUse(process.env.UI_UX_BROWSER_CHANNEL));

type CameraReading = { center: [number, number]; zoom: number; moving: boolean; settling: boolean };
type CameraProbe = {
  read: () => CameraReading;
  project: (coordinate: [number, number]) => { x: number; y: number };
};

type NewsFrame = CameraReading & { label: string | null; headline: string | null };

for (const theme of ["light", "dark"] as const) {
  test(`1440px ${theme} normal-motion area news waits for the settled picker destination`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: theme });
    await installDeterministicMapBasemap(page);
    await page.addInitScript((choice) => {
      localStorage.setItem("pubmax-theme", choice);
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    }, theme);
    let statusReads = 0;
    await page.route("**/api/citymcp/status**", route => {
      statusReads++;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        signals: [
          { headline: "Kingston Market Place closed following fire", severity: "major", areas: ["Kingston"] },
          { headline: "Soho local closure", severity: "notable", areas: ["Soho"] },
        ], tubeLines: [], weather: null,
      }) });
    });
    const initialStatus = page.waitForResponse("**/api/citymcp/status**");
    await page.goto("/map");
    await initialStatus;
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
    const cityDismiss = page.getByRole("button", { name: "Dismiss city suggestion" });
    if (await cityDismiss.isVisible()) await cityDismiss.click();
    const choose = page.locator(".citySwitcherTrigger").filter({ visible: true });
    await choose.click();
    await page.getByRole("button", { name: "This area", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search areas and postcodes" }).fill("Soho");
    await page.locator(".chooseAreaSheet").filter({ visible: true }).getByRole("button", { name: /^Piccadilly & Soho/ }).click();
    const read = () => page.evaluate(() => {
      const probe = (window as Window & { __pubmaxMapCamera?: CameraProbe }).__pubmaxMapCamera;
      if (!probe) throw new Error("camera probe absent");
      return probe.read();
    });
    await expect.poll(async () => { const camera = await read(); return !camera.moving && !camera.settling; }).toBe(true);
    await expect(page.locator(".cityStatusBannerCopy")).toHaveText("Soho local closure");
    const before = await read();
    const readsBeforeFlight = statusReads;
    await choose.click();
    await page.getByRole("button", { name: "This area", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search areas and postcodes" }).fill("Kingston");
    await page.evaluate(() => {
      const state = window as Window & {
        __pubmaxMapCamera?: CameraProbe;
        __areaNewsFrames?: NewsFrame[];
        __areaNewsRecording?: boolean;
        __areaNewsObserver?: MutationObserver;
      };
      state.__areaNewsFrames = [];
      state.__areaNewsRecording = true;
      const sample = () => {
        if (!state.__areaNewsRecording) return;
        const camera = state.__pubmaxMapCamera?.read();
        if (camera) state.__areaNewsFrames?.push({
          ...camera,
          label: [...document.querySelectorAll(".citySwitcherTrigger")].find(trigger => trigger.getClientRects().length > 0)?.getAttribute("aria-label") ?? null,
          headline: document.querySelector(".cityStatusBannerCopy")?.textContent ?? null,
        });
      };
      // Observe the optimistic label before paint, even if the next animation
      // frame advances the camera beyond the small departure window.
      state.__areaNewsObserver = new MutationObserver(sample);
      state.__areaNewsObserver.observe(document.body, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ["aria-label"],
      });
      const sampleFrame = () => {
        if (!state.__areaNewsRecording) return;
        sample();
        requestAnimationFrame(sampleFrame);
      };
      requestAnimationFrame(sampleFrame);
    });
    await page.locator(".chooseAreaSheet").filter({ visible: true }).getByRole("button", { name: "Kingston upon Thames", exact: true }).click();
    await expect.poll(() => page.evaluate(() =>
      (window as Window & { __areaNewsFrames?: NewsFrame[] }).__areaNewsFrames?.some(frame => frame.moving),
    )).toBe(true);
    await expect.poll(async () => { const camera = await read(); return !camera.moving && !camera.settling; }).toBe(true);
    await expect(page.locator(".cityStatusBannerCopy")).toHaveText("Kingston Market Place closed following fire");
    const frames = await page.evaluate(() => {
      const state = window as Window & {
        __areaNewsFrames?: NewsFrame[];
        __areaNewsRecording?: boolean;
        __areaNewsObserver?: MutationObserver;
      };
      state.__areaNewsRecording = false;
      state.__areaNewsObserver?.disconnect();
      return state.__areaNewsFrames ?? [];
    });
    const { writeFileSync } = await import("node:fs");
    const framePath = testInfo.outputPath("normal-motion-news.json");
    writeFileSync(framePath, JSON.stringify({ before, after: await read(), frames, statusReads }, null, 2));
    await testInfo.attach("normal-motion-news", { contentType: "application/json", path: framePath });
    // The destination label must not show its news over Soho, including the
    // pending camera move. Actual animation is asserted separately above.
    const leavingSoho = frames.filter(frame => frame.label?.includes("Kingston") &&
      Math.abs(frame.center[0] - before.center[0]) < 0.005 && Math.abs(frame.center[1] - before.center[1]) < 0.005);
    expect(leavingSoho.length).toBeGreaterThan(0);
    expect(leavingSoho.map(frame => frame.headline)).not.toContain("Kingston Market Place closed following fire");
    expect(statusReads).toBe(readsBeforeFlight);
    expect(await page.evaluate(() => localStorage.getItem("pubmaxx:analytics-consent:v1"))).toBe("denied");
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`1440px ${theme} Richmond alias and real camera movement remove city-wide news outside London`, async ({ page }) => {
    test.setTimeout(150_000);
    const evidence = "artifacts/area-news-toast";
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await installDeterministicMapBasemap(page);
    await page.addInitScript((choice) => {
      localStorage.setItem("pubmax-theme", choice);
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    }, theme);
    await page.route("**/api/citymcp/status**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      signals: [
        { headline: "London-wide transport strike", severity: "major", areas: ["London"] },
        { headline: "Richmond local closure", severity: "notable", areas: ["Richmond upon Thames"], sourceUrl: "https://example.com/richmond" },
        { headline: "Richmond Park closure", severity: "major", areas: ["Richmond Park"] },
        { headline: "Unlocated major alert", severity: "major", areas: [] },
        { headline: "Bermondsey fire", severity: "major", areas: ["Bermondsey", "London"] },
      ], tubeLines: [{ line: "Northern", status: "Severe Delays" }], weather: null,
    }) }));
    await page.goto("/map");
    const copy = page.locator(".cityStatusBannerCopy");
    await expect(copy).toHaveText("London-wide transport strike", { timeout: 45_000 });
    await page.screenshot({ path: `${evidence}/london-citywide-${theme}.png` });
    const cityDismiss = page.getByRole("button", { name: "Dismiss city suggestion" });
    if (await cityDismiss.isVisible()) await cityDismiss.click();
    const choose = page.locator(".citySwitcherTrigger").filter({ visible: true });
    await expect(async () => {
      await choose.click();
      await expect(page.getByRole("button", { name: "This area", exact: true })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    await page.getByRole("button", { name: "This area", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search areas and postcodes" }).fill("Richmond");
    await page.locator(".chooseAreaSheet").filter({ visible: true }).getByRole("button", { name: "Richmond", exact: true }).click();
    await expect(choose).toHaveAttribute("aria-label", /Map area: Richmond/i);
    await expect(copy).toHaveText("Richmond local closure", { timeout: 30_000 });
    await page.locator(".cityStatusBannerLink").click();
    await expect(page.locator(".cityStatusSignalRowHeadline")).toHaveText(["Richmond local closure"]);
    await expect(page.locator(".cityStatusBannerMobileCopy")).not.toContainText(" · 1");
    await expect(page.locator(".cityStatusSignalSheet")).not.toContainText("Northern");
    await expect(page.locator(".cityStatusSignalSheet")).not.toContainText("Richmond Park closure");
    await expect(page.locator(".cityStatusSignalRowSource a")).toHaveAttribute("href", "https://example.com/richmond");
    await page.screenshot({ path: `${evidence}/richmond-filtered-feed-${theme}.png` });
    await page.keyboard.press("Escape");
    const read = () => page.evaluate(() => {
      const probe = (window as Window & { __pubmaxMapCamera?: CameraProbe }).__pubmaxMapCamera;
      if (!probe) throw new Error("camera probe absent");
      return probe.read();
    });
    await expect.poll(async () => { const c = await read(); return !c.moving && !c.settling; }).toBe(true);
    const before = await read();
    for (let i = 0; i < 8 && (await read()).zoom > 9.5; i++) {
      await page.getByRole("button", { name: "Zoom out", exact: true }).click();
      await expect.poll(async () => !(await read()).moving).toBe(true);
    }
    // The probe reads the real camera. All movement comes from mouse drags.
    for (let i = 0; i < 8; i++) {
      const c = await read();
      if (Math.abs(c.center[0] + 0.57) < 0.015 && Math.abs(c.center[1] - 51.236) < 0.015) break;
      const delta = await page.evaluate(() => {
        const probe = (window as Window & { __pubmaxMapCamera?: CameraProbe }).__pubmaxMapCamera;
        if (!probe) throw new Error("camera probe absent");
        const centre = probe.project(probe.read().center);
        const target = probe.project([-0.57, 51.236]);
        return { x: centre.x - target.x, y: centre.y - target.y };
      });
      await page.mouse.move(950, 550);
      await page.mouse.down();
      await page.mouse.move(950 + Math.max(-220, Math.min(220, delta.x)), 550 + Math.max(-220, Math.min(220, delta.y)), { steps: 25 });
      await page.mouse.up();
      await expect.poll(async () => !(await read()).moving).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await expect.poll(async () => !(await read()).moving).toBe(true);
    }
    const outside = await read();
    await page.screenshot({ path: `${evidence}/outside-london-surrey-${theme}.png` });
    expect(Math.abs(outside.center[0] + 0.57)).toBeLessThan(0.015);
    expect(Math.abs(outside.center[1] - 51.236)).toBeLessThan(0.015);
    await expect(copy).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(".cityStatusSignalSheet")).toHaveCount(0);
    await page.screenshot({ path: `${evidence}/outside-london-surrey-${theme}.png` });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${evidence}/camera-transition-${theme}.json`, JSON.stringify({ before, outside, url: page.url(), areaLabel: await choose.getAttribute("aria-label"), result: "No local, London-wide, unlocated, or TfL toast over Surrey" }, null, 2));
  });
}
