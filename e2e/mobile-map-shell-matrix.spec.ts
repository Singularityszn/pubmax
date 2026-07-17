import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  expectContainedInSheetBody,
  mockScrollableMobileSheets,
} from "./support/mobileMapSheets";

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const THEMES = ["light", "dark"] as const;

test.setTimeout(150_000);

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - window.innerWidth,
    document.body.scrollWidth - window.innerWidth,
  ))).toBeLessThanOrEqual(1);
}

async function expectTouchTargets(locator: Locator): Promise<void> {
  const boxes = await locator.evaluateAll((elements) => elements
    .filter((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    })
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { label: element.getAttribute("aria-label") ?? element.textContent?.trim(), width: rect.width, height: rect.height };
    }));
  for (const box of boxes) {
    expect(box.width, `${box.label} target width`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${box.label} target height`).toBeGreaterThanOrEqual(44);
  }
}

async function saveShot(page: Page, name: string): Promise<void> {
  if (!process.env.PUBMAX_RESET_SHOTS) return;
  const png = await page.screenshot({ fullPage: false });
  await mkdir("docs/screenshots/mobile-reset", { recursive: true });
  await writeFile(`docs/screenshots/mobile-reset/${name}.png`, png);
}

async function waitForMapPaint(page: Page): Promise<void> {
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await canvas.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`coordinated map shell ${viewport.width}x${viewport.height} ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript((initialTheme) => {
        window.localStorage.setItem("pubmax-theme", initialTheme);
        window.localStorage.setItem("pubmax-tour-v1-done", "1");
        window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
        window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
        window.sessionStorage.setItem("pubmax-e2e-geo-calls", "0");
        Object.defineProperty(navigator, "geolocation", {
          configurable: true,
          value: {
            getCurrentPosition(success: PositionCallback) {
              const calls = Number(window.sessionStorage.getItem("pubmax-e2e-geo-calls") ?? "0") + 1;
              window.sessionStorage.setItem("pubmax-e2e-geo-calls", String(calls));
              success({ coords: { latitude: 51.515, longitude: -0.09, accuracy: 10 } } as GeolocationPosition);
            },
          },
        });
      }, theme);
      await mockScrollableMobileSheets(page);

      const response = await page.goto("/map");
      expect(response?.status()).toBe(200);
      await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".mobileMapRail")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 30_000 });
      await waitForMapPaint(page);

      expect(await page.evaluate(() => window.sessionStorage.getItem("pubmax-e2e-geo-calls"))).toBe("0");
      await expect(page.getByRole("button", { name: "Near me" })).toBeVisible();
      const viewportBeforeNearby = await page.evaluate(() => {
        const raw = JSON.parse(window.localStorage.getItem("pubmaxx.mobile-map-session.v1") ?? "null") as { viewport?: unknown } | null;
        return JSON.stringify(raw?.viewport ?? null);
      });
      await page.getByRole("button", { name: "Near me" }).click();
      await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("pubmax-e2e-geo-calls"))).toBe("1");
      const nearbyChip = page.getByRole("button", { name: "Nearby" });
      await expect(nearbyChip).toBeVisible();
      const nearbyCount = Number.parseInt((await nearbyChip.innerText()).replace(/\D+/g, ""), 10);
      expect(nearbyCount).toBeGreaterThan(0);
      await expect(page.locator(".mapCanvasWrap")).toHaveAttribute("data-venue-count", String(nearbyCount));
      await expect.poll(() => page.evaluate(() => {
        const raw = JSON.parse(window.localStorage.getItem("pubmaxx.mobile-map-session.v1") ?? "null") as { viewport?: unknown } | null;
        return JSON.stringify(raw?.viewport ?? null);
      })).not.toBe(viewportBeforeNearby);
      await waitForMapPaint(page);

      const chromeRows = page.locator(".mobileMapChrome > :visible");
      await expect(chromeRows).toHaveCount(2);
      const navLinks = page.getByRole("navigation", { name: "Primary" }).getByRole("link");
      await expect(navLinks).toHaveCount(5);
      await expect(navLinks).toHaveText(["Map", "Tonight", "Moment", "Stories", "You"]);
      await expect(navLinks.filter({ hasText: "Moment" })).not.toHaveAttribute("aria-current");
      await expect(navLinks.filter({ hasText: "Map" })).toHaveAttribute("aria-current", "page");

      for (const selector of [
        ".mapStage > .mapToolbar",
        ".mapStage > .citySuggestBanner",
        ".mapStage > .cityStatusBanner",
        ".mapStage > .mapConciergeAsk",
        ".mapStage > .tonightLane",
        ".mapStage > .mapPriceControl",
        ".mapStage > .mapLayersControl",
      ]) {
        await expect(page.locator(selector)).toHaveCount(0);
      }

      await expectTouchTargets(page.locator(".mobileMapTopbar button, .mobileMapRail button, .mobileTabBar a"));
      await expectNoHorizontalOverflow(page);
      await saveShot(page, `map-${viewport.width}x${viewport.height}-${theme}`);

      await page.getByRole("button", { name: "More map controls" }).click();
      await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Plan tonight" })).toBeVisible();
      const sheetBefore = await page.locator(".mobileSharedSheet").boundingBox();
      expect(sheetBefore?.x).toBe(0);
      expect(sheetBefore?.width).toBe(viewport.width);

      const toggle = page.getByRole("button", { name: `Switch to ${theme === "light" ? "dark" : "light"} theme` });
      await toggle.click();
      const nextTheme = theme === "light" ? "dark" : "light";
      await expect(page.locator("html")).toHaveAttribute("data-theme", nextTheme);
      await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);
      const sheetAfter = await page.locator(".mobileSharedSheet").boundingBox();
      expect(sheetAfter).toEqual(sheetBefore);
      await page.getByRole("button", { name: `Switch to ${theme} theme` }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const layerTabs = page.getByRole("tablist", { name: "Layer settings sections" });
      const layersTab = layerTabs.getByRole("tab", { name: "Layers" });
      await layersTab.focus();
      await page.keyboard.press("ArrowRight");
      await expect(layerTabs.getByRole("tab", { name: "Prices" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByText("Maximum pint price")).toBeVisible();
      await page.keyboard.press("ArrowLeft");
      await expect(layersTab).toHaveAttribute("aria-selected", "true");

      await page.getByRole("button", { name: "Close Map layers" }).click();
      await page.getByRole("button", { name: "Drinks" }).click();
      const filtersSheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]:visible');
      await expect(filtersSheet).toHaveCount(1);
      await expect(filtersSheet.getByRole("heading", { name: "Drinks and price" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await saveShot(page, `filters-${viewport.width}x${viewport.height}-${theme}`);
      await filtersSheet.getByRole("button", { name: "Close Drinks and price" }).click();

      // Exercise the repaired transition path with motion enabled: the sheet
      // must be full-width only after its detent animation has settled.
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.getByRole("button", { name: /Tonight/ }).click();
      const tonightSheet = page.locator('.mobileSheetPortal[data-sheet-kind="tonight"]');
      await expect(tonightSheet.locator(".mobileSharedSheet")).toHaveClass(/sheet-full/);
      const tonightBody = tonightSheet.locator(".mobileSharedSheetBody");
      const tonightLane = tonightBody.locator(".tonightLane--open");
      await expect(tonightLane).toBeVisible();
      await expectContainedInSheetBody(tonightLane);
      const tonightScroll = tonightSheet.locator(".tonightLaneScroll");
      await tonightScroll.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
      await expect.poll(() => tonightScroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
      await expectNoHorizontalOverflow(page);
      await tonightSheet.getByRole("button", { name: "Close Tonight" }).click();

      await page.getByRole("button", { name: /TfL/ }).click();
      const tflSheet = page.locator('.mobileSheetPortal[data-sheet-kind="tfl"]');
      await expect(tflSheet.locator(".mobileSharedSheet")).toHaveClass(/sheet-full/);
      const tflBody = tflSheet.locator(".mobileSharedSheetBody");
      await expect(tflBody).toHaveCSS("overflow-y", "auto");
      await expect.poll(() => tflBody.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(0);
      await tflBody.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await expect(tflSheet.getByText("Test line 14")).toBeInViewport();
      await expectNoHorizontalOverflow(page);
      await tflSheet.getByRole("button", { name: "Close TfL live" }).click();
      await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(0);
    });
  }
}

test("venue selection opens exactly one coordinated sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.goto("/map?sel=venue-xjf3n0");
  await expect(page.locator('.mobileSheetPortal[data-sheet-kind="venue"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);
  await expect(page.locator(".mapDrawer.right.open:visible")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Stories", exact: true }).click();
  await expect(page.locator(".mobileSharedSheet")).toHaveClass(/sheet-full/);
});

test("TfL status is fresh in the rail before its grouped sheet opens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  let statusRequests = 0;
  await page.route("**/api/citymcp/status**", (route) => {
    statusRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-15T21:05:00.000Z",
        signals: [
          { headline: "Crowding near the river", kind: "alert", severity: "notable" },
          { headline: "Late museum opening", kind: "event", severity: "info" },
        ],
        tubeLines: [{ line: "Central", status: "Minor delays", disruption: "Signal fault" }],
      }),
    });
  });

  await page.goto("/map");
  const tflChip = page.getByRole("button", { name: /TfL/ });
  await expect(tflChip).toContainText("3");
  expect(statusRequests).toBe(1);
  await expect(page.locator('.mobileSheetPortal[data-sheet-kind="tfl"]')).toHaveCount(0);

  await tflChip.click();
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="tfl"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(/Updated/)).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Alerts" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Transport" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Events" })).toBeVisible();
});

for (const width of [320, 390]) {
  test(`Moment pub picker stays visible in its only sheet at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await page.goto("/map?log=1&max=0");
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="moment"]');
    await expect(sheet).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);
    await expect(sheet.locator(".mobileSharedSheet")).toHaveClass(/sheet-full/);
    await expect(sheet.getByText("Pick a pub to log a Pint Drop")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Search pubs" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

for (const theme of THEMES) {
  test(`London basemap hierarchy at z10 z12 z14 z16 ${theme}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((initialTheme) => {
      window.localStorage.setItem("pubmax-theme", initialTheme);
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    }, theme);
    await page.goto("/map");
    await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
    await expect.poll(() => page.evaluate(() =>
      window.localStorage.getItem("pubmaxx.mobile-map-session.v1"),
    )).not.toBeNull();

    for (const [zoom, pitch] of [[10, 0], [12, 22], [14, 40], [16, 50]] as const) {
      await page.evaluate(({ nextZoom, nextPitch }) => {
        const key = "pubmaxx.mobile-map-session.v1";
        const raw = JSON.parse(window.localStorage.getItem(key) ?? "null") as Record<string, unknown> | null;
        if (!raw) throw new Error("mobile map session missing");
        raw.viewport = { center: [-0.102, 51.513], zoom: nextZoom, pitch: nextPitch, bearing: 0 };
        raw.selectedVenueId = null;
        raw.openSheet = null;
        window.localStorage.setItem(key, JSON.stringify(raw));
      }, { nextZoom: zoom, nextPitch: pitch });
      await page.reload();
      await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
      await waitForMapPaint(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect.poll(() => page.evaluate(() => {
        const raw = JSON.parse(window.localStorage.getItem("pubmaxx.mobile-map-session.v1") ?? "null") as { viewport?: { zoom?: number } } | null;
        return raw?.viewport?.zoom ?? -1;
      })).toBeCloseTo(zoom, 1);
      if (zoom === 14) {
        await expect.poll(async () => Number(
          await page.locator(".mapCanvasWrap").getAttribute("data-rendered-station-count") ?? "0",
        )).toBeGreaterThan(0);
      }
      await saveShot(page, `map-z${zoom}-390x844-${theme}`);
    }
  });
}
