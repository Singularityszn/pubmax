import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { expectMobileMapShellReady, mobileMapShellControl, routeTubeStatus } from "./helpers/mobileMapShell";


const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const THEMES = ["light", "dark"] as const;

test.setTimeout(90_000);

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

// A shared sheet sizes to its body up to the detent cap, so it grows while the
// body mounts. Read its box only once two reads in a row agree.
async function settledBox(locator: Locator) {
  let previous = "";
  await expect.poll(async () => {
    const box = JSON.stringify(await locator.boundingBox());
    const settled = box === previous;
    previous = box;
    return settled;
  }).toBe(true);
  return locator.boundingBox();
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
            watchPosition() { return 1; },
            clearWatch() {},
          },
        });
      }, theme);
      // A routine night: TfL rests in More map controls, not on the edge.
      await routeTubeStatus(page, "routine");

      const response = await page.goto("/map");
      expect(response?.status()).toBe(200);
      await expectMobileMapShellReady(page, 30_000);
      // ONE bar (design judgement 2026-08-01, finding 2.3): no control rail.
      await expect(page.locator(".mobileMapRail")).toHaveCount(0);
      const nearMe = await mobileMapShellControl(page, "nearMe");
      await expect(nearMe).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 30_000 });
      await waitForMapPaint(page);

      expect(await page.evaluate(() => window.sessionStorage.getItem("pubmax-e2e-geo-calls"))).toBe("0");
      await expect(nearMe).toHaveAccessibleName("Near me");
      const viewportBeforeNearby = await page.evaluate(() => {
        const raw = JSON.parse(window.localStorage.getItem("pubmaxx.mobile-map-session.v1") ?? "null") as { viewport?: unknown } | null;
        return JSON.stringify(raw?.viewport ?? null);
      });
      await nearMe.click();
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
      const nearMeClose = page.getByRole("button", { name: "Close Near me" });
      if (await nearMeClose.isVisible().catch(() => false)) {
        await nearMeClose.click();
        await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(0);
      }

      const chromeRows = page.locator(".mobileMapChrome > :visible");
      await expect(chromeRows).toHaveCount(2);
      const navLinks = page.getByRole("navigation", { name: "Primary" }).getByRole("link");
      // Six destinations, and the Pub Pal's own door between Tonight and Plan.
      await expect(navLinks).toHaveCount(7);
      await expect(navLinks).toHaveText(["Map", "Tonight", "Pal", "Plan", "Spoons", "Social", "You"]);
      await expect(navLinks.filter({ hasText: "Map" })).toHaveAttribute("aria-current", "page");

      const utilityCorner = page.locator(".mobileMapUtilityCorner");
      await expect(utilityCorner).toBeVisible();
      // The map edge holds the Near me FAB at the thumb, and nothing else on a
      // routine night: TfL comes to the edge only for a badly disrupted line
      // (components/mobile/MobileMapShell.tsx MapEdgeControls).
      await expect(utilityCorner.getByRole("button")).toHaveCount(1);
      await expect(await mobileMapShellControl(page, "tfl")).toHaveCount(0);
      await expect(nearMe).toHaveAttribute("aria-pressed", "true");
      await expect(utilityCorner.getByRole("button", { name: "List view of venues on the map" })).toHaveCount(0);

      for (const selector of [
        ".mapStage > .mapToolbar",
        ".mapStage > .citySuggestBanner",
        ".mapStage > .cityStatusBanner",
        ".mapStage > .mapConciergeAsk",
        ".mapStage > .tonightLane",
        ".mapStage > .mapLayersControl",
      ]) {
        await expect(page.locator(selector)).toHaveCount(0);
      }

      await expectTouchTargets(page.locator(".mobileMapTopbar button, .mobileMapUtilityCorner button, .mobileTabBar a"));
      await expectNoHorizontalOverflow(page);
      await saveShot(page, `map-${viewport.width}x${viewport.height}-${theme}`);

      const more = await mobileMapShellControl(page, "more");
      await more.click();
      await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);
      await expect(
        page.getByRole("tablist", { name: "Map control sections" }),
      ).toBeVisible();

      // The sheet is as tall as its tab's body, so the theme toggle is judged
      // on the Layers tab it lives in, after the entrance has finished.
      const layerTabs = page.getByRole("tablist", { name: "Map control sections" });
      const layersTab = layerTabs.getByRole("tab", { name: "Layers" });
      const toggle = page.getByRole("button", { name: `Switch to ${theme === "light" ? "dark" : "light"} theme` });
      await expect(async () => {
        await layersTab.click();
        await expect(layersTab).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
        await expect(toggle).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      // The map layers group is a dynamic chunk (components/PubMap.tsx) fetched
      // when this tab first renders, and its Place stories chips grow the sheet
      // to its cap when they land. Two equal reads before then are not a
      // settled sheet, so wait for the chips.
      await expect(
        page.getByRole("group", { name: "Place stories" }).getByRole("button").first(),
      ).toBeVisible();
      await expect(page.locator(".mobileSharedSheet")).not.toHaveClass(/sheet-entering/);
      const sheetBefore = await settledBox(page.locator(".mobileSharedSheet"));
      expect(sheetBefore?.x).toBe(0);
      expect(sheetBefore?.width).toBe(viewport.width);
      await toggle.click();
      const nextTheme = theme === "light" ? "dark" : "light";
      await expect(page.locator("html")).toHaveAttribute("data-theme", nextTheme);
      await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(1);
      const sheetAfter = await page.locator(".mobileSharedSheet").boundingBox();
      expect(sheetAfter).toEqual(sheetBefore);
      await page.getByRole("button", { name: `Switch to ${theme} theme` }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      await layersTab.focus();
      await page.keyboard.press("ArrowRight");
      await expect(layerTabs.getByRole("tab", { name: "Prices" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByText("Maximum pint price")).toBeVisible();
      await page.keyboard.press("ArrowLeft");
      await expect(layersTab).toHaveAttribute("aria-selected", "true");

      const listShortcut = page
        .locator('.mobileSheetPortal[data-sheet-kind="layers"]:visible')
        .getByRole("button", { name: "List view of venues on the map" });
      await expect(listShortcut).toBeVisible();
      await expectTouchTargets(listShortcut);
      await listShortcut.click();
      await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(0);
      await expect(page.locator(".mapVenueListPanel")).toBeVisible();
      await expect(page.getByTestId("create-fab")).toBeHidden();
      await expect(page.getByRole("heading", { name: "Venues on the map" })).toBeVisible();
      // Opened from Map controls, the list offers Back, so its close names the map
      // it returns to (components/map/MapVenueList.tsx).
      await page.getByRole("button", { name: "Close and return to the London map" }).click();
      await expect(page.locator(".mapVenueListPanel")).toHaveCount(0);
      await expect(page.getByTestId("create-fab")).toBeVisible();

      await more.click();
      await page.getByRole("button", { name: "Close Map controls" }).click();
      await (await mobileMapShellControl(page, "filters")).click();
      const filtersSheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]:visible');
      await expect(filtersSheet).toHaveCount(1);
      await expect(filtersSheet.getByRole("heading", { name: "Prices and places" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await saveShot(page, `filters-${viewport.width}x${viewport.height}-${theme}`);
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

test("TfL badges a badly disrupted line, and only that", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.route("**/api/citymcp/status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-15T21:05:00.000Z",
        signals: [],
        tubeLines: [
          { line: "Central", status: "Minor delays" },
          { line: "Victoria", status: "Severe delays", disruption: "Signal failure" },
          { line: "Jubilee", status: "Planned closure" },
        ],
      }),
    }),
  );
  await page.goto("/map");
  // The chip is phone shell chrome, held until the map's loading frame lets go
  // (`mobileShellReady` in components/PubMap.tsx), so it is owed the shell's
  // readiness ceiling rather than the default expect timeout.
  const tflChip = await mobileMapShellControl(page, "tfl");
  await expect(tflChip.locator(".mobileMapCornerBadge")).toHaveText("1");
  await expect(tflChip).toHaveAttribute(
    "aria-label",
    "TfL live: 1 line badly disrupted, 3 updates",
  );
});

test("TfL status is fresh in More map controls before its Transit tab opens", async ({ page }) => {
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
  const tflChip = await mobileMapShellControl(page, "tfl");
  // Three routine updates put nothing on the resting map: a TfL control there
  // says something is urgent. The feed is read once all the same, so the
  // Transit tab opens on fresh status rather than a second request.
  await expect.poll(() => statusRequests).toBe(1);
  await expect(await mobileMapShellControl(page, "nearMe")).toBeVisible();
  await expect(tflChip).toHaveCount(0);
  await expect(page.locator('.mobileSheetPortal[data-sheet-kind="tfl"]')).toHaveCount(0);

  await (await mobileMapShellControl(page, "more")).click();
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="layers"]');
  await expect(sheet).toBeVisible();
  await sheet
    .getByRole("tablist", { name: "Map control sections" })
    .getByRole("tab", { name: "Transit" })
    .click();
  expect(statusRequests).toBe(1);
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
    await expectMobileMapShellReady(page, 45_000);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
    await expect.poll(() => page.evaluate(() =>
      window.localStorage.getItem("pubmaxx.mobile-map-session.v1"),
    )).not.toBeNull();

    for (const [zoom, pitch] of [[10, 0], [12, 22], [14, 40], [16, 50]] as const) {
      // Leave the map before writing its camera. A live map keeps writing both
      // stores: the session on every camera change, the resume cache in idle
      // time after one. Its opening turn or a late resume write landing between this
      // write and the reopen put the map back at its own camera, not this one.
      await page.goto("/offline.html");
      await page.evaluate(({ nextZoom, nextPitch }) => {
        const key = "pubmaxx.mobile-map-session.v1";
        const raw = JSON.parse(window.localStorage.getItem(key) ?? "null") as Record<string, unknown> | null;
        if (!raw) throw new Error("mobile map session missing");
        const viewport = { center: [-0.102, 51.513], zoom: nextZoom, pitch: nextPitch, bearing: 0 };
        raw.viewport = viewport;
        raw.selectedVenueId = null;
        raw.openSheet = null;
        window.localStorage.setItem(key, JSON.stringify(raw));
        // The map writes the same camera to its resume cache (lib/mapResume.ts),
        // and that cache wins on reopen, so both stores carry the camera.
        const resumeKey = "map-resume:v2:london:view";
        const resume = JSON.parse(window.localStorage.getItem(resumeKey) ?? "null") as Record<string, unknown> | null;
        if (resume) {
          resume.viewport = viewport;
          window.localStorage.setItem(resumeKey, JSON.stringify(resume));
        }
      }, { nextZoom: zoom, nextPitch: pitch });
      await page.goto("/map");
      await expectMobileMapShellReady(page, 45_000);
      await waitForMapPaint(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect.poll(() => page.evaluate(() => {
        const raw = JSON.parse(window.localStorage.getItem("pubmaxx.mobile-map-session.v1") ?? "null") as { viewport?: { zoom?: number } } | null;
        return raw?.viewport?.zoom ?? -1;
      })).toBeCloseTo(zoom, 1);
      await saveShot(page, `map-z${zoom}-390x844-${theme}`);
    }
  });
}
