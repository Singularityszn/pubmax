import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { GESTURE_CAMERA_HOLD_MS } from "../lib/mapGestureGuard";
import recordedSohoWalk from "./fixtures/soho-walk-route.json";
// A real short Soho walk reproduced with the saved-plan map link.
const STOP_IDS = ["venue-7tarkc", "venue-122cuu1", "venue-s2ppfm"];

const scenarios = [
  ...[320, 390, 768, 1280, 1440].map(width => ({ width, theme: "dark", recordedRoad: false })),
  { width: 390, theme: "light", recordedRoad: true },
];

for (const { width, theme, recordedRoad } of scenarios) {
  test(`a short walking route fills useful map space at ${width}px in ${theme}${recordedRoad ? " with recorded roads" : ""}`, async ({ page, request }, testInfo) => {
    const height = width === 320 ? 568 : width === 390 ? 844 : width === 1280 ? 720 : 900;
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    let roadRequests = 0;
    if (recordedRoad) {
      await page.route("**/api/walk-route?**", async route => {
        const stops = new URL(route.request().url()).searchParams.get("stops");
        expect(stops).toBe("-0.134383,51.5113;-0.135402,51.5108;-0.135301,51.5106");
        await route.fulfill({ json: recordedSohoWalk });
        roadRequests += 1;
      });
    }
    let releaseStatus = () => {};
    const delayedStatus = width === 768 || width === 1280;
    const statusReady = delayedStatus
      ? new Promise<void>((resolve) => { releaseStatus = resolve; })
      : Promise.resolve();
    page.on("close", () => releaseStatus());
    await page.route("**/api/citymcp/status**", async (route) => {
      await statusReady;
      await route.fulfill({ json: {
        asOf: new Date().toISOString(), weather: null, signals: [],
        tubeLines: [
          { line: "Central", status: "Minor Delays" },
          { line: "District", status: "Severe Delays" },
          { line: "Suffragette", status: "Minor Delays" },
        ],
      } });
    });
    const coordinates = await Promise.all(STOP_IDS.map(async (id) => {
      const response = await request.get(`/api/venue/${id}`);
      expect(response.ok()).toBe(true);
      const { venue } = await response.json();
      return [venue.longitude, venue.latitude] as [number, number];
    }));
    await page.addInitScript(({ appearance, personality, voice, theme }) => {
      const now = "2026-10-26T12:00:00.000Z";
      localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: "owner-e2e", name: "Ripley",
        adultAttestedAt: now, appearance, personality, voice, muted: false, hidden: false,
        proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
      }));
      localStorage.setItem("pubmax-theme", theme);
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax-tour-v2-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    }, { ...DEFAULT_PAL_DRAFT, theme });
    await page.goto(`/map?mode=build&pubs=${STOP_IDS.join(",")}`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "3", { timeout: 60_000 });
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect.poll(() => page.evaluate((stops) => {
      const probe = (window as typeof window & {
        __pubmaxMapCamera?: {
          read(): { moving: boolean; settling: boolean };
          project(point: [number, number]): { x: number; y: number };
        };
      }).__pubmaxMapCamera;
      if (!probe || probe.read().moving || probe.read().settling) return false;
      const points = stops.map(point => probe.project(point));
      const span = Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x));
      // At zoom 15 this walk occupied about 60px on a desktop and its discs
      // overlapped. It must be readable, yet keep every stop below the chrome.
      return span >= Math.min(160, innerWidth * 0.4)
        && points.every(point => point.x >= 20 && point.x <= innerWidth - 20
          && point.y >= 170 && point.y <= innerHeight - 180);
    }, coordinates), { timeout: 60_000 }).toBe(true);
    releaseStatus();
    if (delayedStatus) await expect(page.locator(".cityStatusBanner")).toBeVisible();
    await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 60_000 });
    const uncoveredStops = await page.evaluate((stops) => {
      const probe = (window as typeof window & {
        __pubmaxMapCamera?: { project(point: [number, number]): { x: number; y: number } };
      }).__pubmaxMapCamera;
      return stops.map((stop) => {
        const point = probe!.project(stop);
        // A visible centre is insufficient: a banner can cover half a marker
        // and its name. Check the full disc with breathing room above it.
        return [0, -22, 22].every(offset => Boolean(
          document.elementFromPoint(point.x, point.y + offset)?.closest(".maplibregl-canvas"),
        ));
      });
    }, coordinates);
    expect(uncoveredStops).toEqual([true, true, true]);
    const companion = page.locator(".palMapMarker:not([data-pal-crew])");
    await expect(companion).toBeVisible();
    await expect(companion).toHaveAttribute("data-pal-walk", "waiting");
    await expect.poll(() => companion.evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.left >= 8 && box.top >= 8 && box.right <= innerWidth - 8 && box.bottom <= innerHeight - 8;
    })).toBe(true);
    // Pointer-events:none makes elementFromPoint ignore this decorative
    // overlay. Compare its painted bounds with every numbered stop instead.
    await expect.poll(() => page.evaluate((stops) => {
      const probe = (window as typeof window & {
        __pubmaxMapCamera?: { project(point: [number, number]): { x: number; y: number } };
      }).__pubmaxMapCamera;
      const marker = document.querySelector(".palMapMarker:not([data-pal-crew])");
      if (!probe || !marker) return false;
      const box = marker.getBoundingClientRect();
      return stops.every(stop => {
        const point = probe.project(stop);
        const nearestX = Math.max(box.left, Math.min(point.x, box.right));
        const nearestY = Math.max(box.top, Math.min(point.y, box.bottom));
        // The 16px disc has a 2.5px stroke. Include its painted rim and a
        // small gap, not just its fill, when checking the resting companion.
        return Math.hypot(point.x - nearestX, point.y - nearestY) > 18;
      });
    }, coordinates)).toBe(true);
    if (recordedRoad) {
      await expect.poll(() => roadRequests).toBeGreaterThan(0);
      const sample = await page.evaluate((stops) => {
        const probe = (window as typeof window & {
          __pubmaxMapCamera?: { project(point: [number, number]): { x: number; y: number } };
        }).__pubmaxMapCamera!;
        const bend = probe.project([-0.134847, 51.510781]);
        const a = probe.project(stops[0]!);
        const b = probe.project(stops[1]!);
        const t = Math.max(0, Math.min(1, ((bend.x - a.x) * (b.x - a.x) + (bend.y - a.y) * (b.y - a.y))
          / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2)));
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--route-line").trim();
        context.fillRect(0, 0, 1, 1);
        return {
          point: bend,
          straightDistance: Math.hypot(bend.x - (a.x + t * (b.x - a.x)), bend.y - (a.y + t * (b.y - a.y))),
          colour: Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3),
        };
      }, coordinates);
      // This road corner lies away from the fallback. Check painted pixels,
      // not just successful delivery of the recorded provider response.
      expect(sample.straightDistance).toBeGreaterThan(12);
      expect(sample.colour[0]).toBeGreaterThan(sample.colour[1]! + 50);
      const roadPixelCount = async () => {
        const point = await page.evaluate(() => (window as typeof window & {
          __pubmaxMapCamera: { project(point: [number, number]): { x: number; y: number } };
        }).__pubmaxMapCamera.project([-0.134847, 51.510781]));
        if (point.x < 3 || point.y < 3 || point.x > width - 4 || point.y > height - 4) return 0;
        const frame = await page.screenshot({ scale: "css" });
        const { data } = await sharp(frame).extract({
          left: Math.round(point.x) - 3, top: Math.round(point.y) - 3, width: 7, height: 7,
        }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        let matches = 0;
        for (let i = 0; i < data.length; i += 3) {
          if (sample.colour.every((channel, index) => Math.abs(data[i + index]! - channel) < 35)) matches += 1;
        }
        return matches;
      };
      await expect.poll(roadPixelCount).toBeGreaterThan(2);
      const wholeRoadFits = () => page.evaluate((road) => {
        const probe = (window as typeof window & {
          __pubmaxMapCamera: {
            read(): { moving: boolean; settling: boolean };
            project(point: [number, number]): { x: number; y: number };
          };
        }).__pubmaxMapCamera;
        const state = probe.read();
        if (state.moving || state.settling) return false;
        return road.every(coordinate => {
          const point = probe.project(coordinate);
          return point.x >= 18 && point.x <= innerWidth - 18
            && point.y >= 160 && point.y <= innerHeight - 200;
        });
      }, recordedSohoWalk.line.features[0]!.geometry.coordinates as [number, number][]);
      // Stops alone fit in the failing390px screenshot, but the road's western
      // bend leaves the screen. Every recorded road vertex must remain clear.
      await expect.poll(wholeRoadFits).toBe(true);
      const finalStop = await page.evaluate(stop => (window as typeof window & {
        __pubmaxMapCamera: { project(point: [number, number]): { x: number; y: number } };
      }).__pubmaxMapCamera.project(stop), coordinates[2]!);
      await page.mouse.click(finalStop.x, finalStop.y);
      const closeDetail = page.getByRole("button", { name: "Close pub detail", exact: true });
      await expect(closeDetail).toBeVisible();
      await expect(page).toHaveURL(/sel=venue-s2ppfm/);
      await closeDetail.click();
      await expect(closeDetail).not.toBeVisible();
      await expect.poll(() => page.evaluate(() => {
        const camera = (window as typeof window & {
          __pubmaxMapCamera: { read(): { moving: boolean; settling: boolean } };
        }).__pubmaxMapCamera.read();
        return !camera.moving && !camera.settling;
      })).toBe(true);
      await expect.poll(roadPixelCount).toBeGreaterThan(2);
      await expect.poll(wholeRoadFits).toBe(true);
      // Provider arrival can precede a venue-data redraw. A single matching
      // frame must not hide a later regression to the straight fallback.
      for (let frame = 0; frame < 5; frame += 1) {
        expect(await roadPixelCount()).toBeGreaterThan(2);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`short-walk-${width}-${theme}.png`) });
    if (width === 1280) {
      const projectedStops = () => page.evaluate((stops) => {
        const probe = (window as typeof window & {
          __pubmaxMapCamera?: { project(point: [number, number]): { x: number; y: number } };
        }).__pubmaxMapCamera;
        return stops.map(stop => probe!.project(stop));
      }, coordinates);
      const original = await projectedStops();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await page.mouse.move(640, 460);
        await page.mouse.down();
        await page.mouse.move(840, 460, { steps: 12 });
        await expect.poll(async () => Math.abs((await projectedStops())[0]!.x - original[0]!.x))
          .toBeGreaterThan(80);
        await page.mouse.up();
        await page.getByRole("button", { name: "Show whole walk", exact: true }).click();
        await expect.poll(async () => (await projectedStops()).every((point, index) => {
          const before = original[index]!;
          return Math.hypot(point.x - before.x, point.y - before.y) < 5;
        })).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath("route-recovered-twice.png") });
    }
  });
}

test("a road response after a drag waits for Show whole walk before reframing", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  let releaseRoad = () => {};
  let holdRoad = false;
  let warmRoadDelivered = false;
  let requested = false;
  const roadGate = new Promise<void>(resolve => { releaseRoad = resolve; });
  page.on("close", releaseRoad);
  await page.route("**/api/walk-route?**", async route => {
    expect(new URL(route.request().url()).searchParams.get("stops"))
      .toBe("-0.134383,51.5113;-0.135402,51.5108;-0.135301,51.5106");
    if (holdRoad) {
      requested = true;
      await roadGate;
    }
    if (!page.isClosed()) await route.fulfill({ json: recordedSohoWalk });
    if (!holdRoad) warmRoadDelivered = true;
  });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-theme", "light");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax-tour-v2-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  const view = () => page.evaluate(() => {
    const probe = (window as typeof window & {
      __pubmaxMapCamera: {
        read(): { moving: boolean; settling: boolean; zoom: number; bearing: number; pitch: number };
        project(point: [number, number]): { x: number; y: number };
      };
    }).__pubmaxMapCamera;
    return { ...probe.read(), anchor: probe.project([-0.134383, 51.5113]),
      bend: probe.project([-0.134847, 51.510781]) };
  });
  try {
    await page.goto(`/map?mode=build&pubs=${STOP_IDS.join(",")}`);
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "3", { timeout: 60_000 });
    await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 60_000 });
    await expect.poll(() => warmRoadDelivered).toBe(true);
    await expect.poll(async () => { const state = await view(); return !state.moving && !state.settling; }).toBe(true);
    // Paint the map and load its editor before holding any response. Hiding
    // then remapping the same saved stops starts a fresh request through the
    // public UI, so startup cannot consume its eight-second routing timeout.
    await page.getByRole("button", { name: "Edit stops", exact: true }).click();
    await page.getByRole("button", { name: "Hide line", exact: true }).click();
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "0");
    const mapRoute = page.getByRole("button", { name: "Map route", exact: true });
    await expect(mapRoute).toBeVisible();
    holdRoad = true;
    await mapRoute.click();
    await page.getByRole("button", { name: "Close and return to the London map", exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "3");
    await expect.poll(async () => { const state = await view(); return !state.moving && !state.settling; }).toBe(true);
    const before = await view();
    await page.mouse.move(640, 500);
    await page.mouse.down();
    await page.mouse.move(780, 500, { steps: 12 });
    await expect.poll(async () => Math.abs((await view()).anchor.x - before.anchor.x)).toBeGreaterThan(80);
    await page.mouse.up();
    await expect.poll(async () => { const state = await view(); return !state.moving && !state.settling; }).toBe(true);
    const held = await view();
    // Release beyond the generic gesture hold: that hold alone must not make
    // this test pass when a late road response steals the reader's view.
    await page.waitForTimeout(GESTURE_CAMERA_HOLD_MS + 100);
    const responseReady = page.waitForResponse(response => response.url().includes("/api/walk-route?") && response.ok());
    releaseRoad();
    await (await responseReady).finished();
    const routeColour = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--route-line").trim();
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
    });
    expect(routeColour[0]).toBeGreaterThan(routeColour[1]! + 50);
    await expect.poll(async () => {
      const { bend } = await view();
      const frame = await page.screenshot({ scale: "css" });
      const { data } = await sharp(frame).extract({ left: Math.round(bend.x) - 3,
        top: Math.round(bend.y) - 3, width: 7, height: 7 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let matches = 0;
      for (let i = 0; i < data.length; i += 3) {
        if (routeColour.every((channel, index) => Math.abs(data[i + index]! - channel) < 35)) matches += 1;
      }
      return matches;
    }).toBeGreaterThan(2);
    for (let frame = 0; frame < 5; frame += 1) {
      const after = await view();
      expect(Math.hypot(after.anchor.x - held.anchor.x, after.anchor.y - held.anchor.y)).toBeLessThan(1);
      expect(after.zoom).toBeCloseTo(held.zoom, 6);
      expect(after.bearing).toBeCloseTo(held.bearing, 6);
      expect(after.pitch).toBeCloseTo(held.pitch, 6);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    }
    await page.screenshot({ path: testInfo.outputPath("late-road-preserves-drag.png") });
    await page.getByRole("button", { name: "Show whole walk", exact: true }).click();
    await expect.poll(async () => Math.abs((await view()).anchor.x - held.anchor.x)).toBeGreaterThan(40);
    await expect.poll(() => page.evaluate(road => {
      const probe = (window as typeof window & {
        __pubmaxMapCamera: {
          read(): { moving: boolean; settling: boolean };
          project(point: [number, number]): { x: number; y: number };
        };
      }).__pubmaxMapCamera;
      const state = probe.read();
      return !state.moving && !state.settling && road.every(coordinate => {
        const point = probe.project(coordinate);
        return point.x >= 18 && point.x <= innerWidth - 18
          && point.y >= 300 && point.y <= innerHeight - 180;
      });
    }, recordedSohoWalk.line.features[0]!.geometry.coordinates as [number, number][])).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("late-road-explicit-recenter.png") });
  } finally {
    releaseRoad();
  }
});
