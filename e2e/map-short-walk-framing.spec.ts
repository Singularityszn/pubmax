import { randomUUID } from "node:crypto";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";
import { expectMapToolbarReady } from "./helpers/mapToolbar";
import { expectLayoutSettled } from "./helpers/layoutSettled";
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
        read(): { moving: boolean; settling: boolean; zoom: number; bearing: number; pitch: number; center: [number, number] };
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
    const dragged = await view();
    // Release beyond the generic gesture hold: that hold alone must not make
    // this test pass when a late road response steals the reader's view.
    await page.waitForTimeout(GESTURE_CAMERA_HOLD_MS + 100);
    await page.setViewportSize({ width: 1100, height: 900 });
    await expectLayoutSettled(page.locator(".mapCanvasWrap .maplibregl-canvas"));
    await expect.poll(async () => { const state = await view(); return !state.moving && !state.settling; }).toBe(true);
    const held = await view();
    expect(held.zoom).toBeCloseTo(dragged.zoom, 6);
    expect(held.center[0]).toBeCloseTo(dragged.center[0], 6);
    expect(held.center[1]).toBeCloseTo(dragged.center[1], 6);
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

test("a late road response preserves an explicit area search and its resized view", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  let holdRoad = false;
  let requested = false;
  let warmRoadDelivered = false;
  let releaseRoad = () => {};
  const roadGate = new Promise<void>(resolve => { releaseRoad = resolve; });
  page.on("close", releaseRoad);
  await page.route("**/api/walk-route?**", async route => {
    if (holdRoad) {
      requested = true;
      await roadGate;
    }
    if (!page.isClosed()) await route.fulfill({ json: recordedSohoWalk });
    if (!holdRoad) warmRoadDelivered = true;
  });
  const view = () => page.evaluate(() => (window as typeof window & {
    __pubmaxMapCamera: { read(): { moving: boolean; settling: boolean; zoom: number; bearing: number; pitch: number; center: [number, number] } };
  }).__pubmaxMapCamera.read());
  try {
    await page.goto(`/map?mode=build&pubs=${STOP_IDS.join(",")}`);
    await expect(page.locator(".mapLoading")).toHaveCount(0, { timeout: 60_000 });
    await expect.poll(() => warmRoadDelivered).toBe(true);
    await expectMapToolbarReady(page);
    await page.getByRole("button", { name: "Edit stops", exact: true }).click();
    await page.getByRole("button", { name: "Hide line", exact: true }).click();
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "0");
    holdRoad = true;
    await page.getByRole("button", { name: "Map route", exact: true }).click();
    await page.getByRole("button", { name: "Close and return to the London map", exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await expect.poll(async () => { const state = await view(); return !state.moving && !state.settling; }).toBe(true);
    const walk = await view();
    await page.locator(".mapToolbar").getByRole("combobox", { name: "Search pubs" }).fill("White");
    await page.getByRole("group", { name: "Areas", exact: true })
      .getByRole("option", { name: /Whitechapel/i }).click();
    await expect.poll(async () => Math.abs((await view()).center[0] - walk.center[0])).toBeGreaterThan(0.01);
    await expect.poll(async () => { const state = await view(); return !state.moving && !state.settling; }).toBe(true);
    const chosen = await view();
    const responseReady = page.waitForResponse(response => response.url().includes("/api/walk-route?") && response.ok());
    releaseRoad();
    await (await responseReady).finished();
    for (let frame = 0; frame < 5; frame += 1) {
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      const after = await view();
      expect(after.center[0]).toBeCloseTo(chosen.center[0], 6);
      expect(after.center[1]).toBeCloseTo(chosen.center[1], 6);
      expect(after.zoom).toBeCloseTo(chosen.zoom, 6);
      expect(after.bearing).toBeCloseTo(chosen.bearing, 6);
      expect(after.pitch).toBeCloseTo(chosen.pitch, 6);
    }
    await page.setViewportSize({ width: 1100, height: 900 });
    await expectLayoutSettled(page.locator(".mapCanvasWrap .maplibregl-canvas"));
    const resized = await view();
    expect(resized.center[0]).toBeCloseTo(chosen.center[0], 6);
    expect(resized.center[1]).toBeCloseTo(chosen.center[1], 6);
    expect(resized.zoom).toBeCloseTo(chosen.zoom, 6);
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "3");
    await page.getByRole("button", { name: "Show whole walk", exact: true }).click();
    await expect.poll(async () => Math.abs((await view()).center[0] - chosen.center[0])).toBeGreaterThan(0.01);
  } finally {
    releaseRoad();
  }
});

// Independent fixture: committed catalogue revision768f69c954a9 and Root/QA's
// west-to-east test order. This is not an optimal walk or current-price claim.
const SOHO_FOUR_PUBS = [
  { id: "venue-nyowgc", name: "Coach & Horses", address: "1 Great Malborough Street, W1F 7HG", lng: -0.137432, lat: 51.5149 },
  { id: "venue-xiesdn", name: "The Dog & Duck", address: "18 Bateman St, London W1D 3AJ", lng: -0.132014, lat: 51.514 },
  { id: "venue-15i2wst", name: "Golden Lion (Soho)", address: "51 Dean St, London W1D 5BH, UK", lng: -0.131572, lat: 51.5125 },
  { id: "venue-phqazo", name: "The Coach & Horses", address: "29 Greek St, London W1D 5DH", lng: -0.130129, lat: 51.5133 },
] as const;
const SOHO_FOUR_MAP_HREF = "/map?mode=build&pubs=venue-nyowgc%2Cvenue-xiesdn%2Cvenue-15i2wst%2Cvenue-phqazo";
const SOHO_FOUR_ORDER = "venue-nyowgc,venue-xiesdn,venue-15i2wst,venue-phqazo";
const SOHO_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "portrait", width: 390, height: 844 },
  { name: "landscape", width: 844, height: 390 },
] as const;

type SohoProbeWindow = Window & {
  __pubmaxMapCamera?: {
    read(): { moving: boolean; settling: boolean };
    project(point: [number, number]): { x: number; y: number };
  };
  __pubmaxPaintedMapTapPoints?: (() => Array<{ kind: string; id: string; x: number; y: number }>) & {
    state?: () => { loaded: boolean; sourceLoaded: Record<string, boolean | null> };
    trace?: typeof import("../components/map/canvas/pubHitTrace").pubHitTrace;
  };
};

for (const { theme, motion } of [
  { theme: "light", motion: "reduce" },
  { theme: "dark", motion: "reduce" },
  { theme: "dark", motion: "no-preference" },
] as const) {
  test(`four Soho pubs keep their identities and approximate walk visible across desktop and phone resizing in ${theme}${motion === "no-preference" ? " with motion" : ""}`, async ({ page, context, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    testInfo.annotations.push({ type: "visual-review-required",
      description: "Review every fit image for four complete numbered discs, correct stop numbers and readable labels. Automated public-pin checks do not prove these details." });
    expect(baseURL, "this write fixture requires a private local server").toBeTruthy();
    expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL!).hostname);
    await installAuthDoubles(page);
    await seedSignedIn(page, "A");
    await page.setViewportSize({ width: SOHO_VIEWPORTS[0].width, height: SOHO_VIEWPORTS[0].height });
    await page.emulateMedia({ reducedMotion: motion, colorScheme: theme });
    await page.addInitScript((chosenTheme) => {
      localStorage.setItem("pubmax-theme", chosenTheme);
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax-tour-v2-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    }, theme);
    // External routing failure only. Never invent a road or call a provider.
    await page.route("**/api/walk-route?**", (route) => route.fulfill({
      status: 503, json: { error: "Walking route unavailable.", code: "UNAVAILABLE", retryable: true },
    }));
    // The existing local public API creates the saved-plan precondition.
    // Member capability stays in memory. The real generator/Lock it in journey
    // remains covered by plan-route-map and map-crawl-spa-handoff.
    const created = await context.request.post("/api/plans", {
      headers: { "idempotency-key": randomUUID() },
      data: {
        title: "Four Soho pubs", creatorName: "Soho route fixture",
        startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        stops: SOHO_FOUR_PUBS.map((pub) => ({ venueId: pub.id, venueName: pub.name })),
      },
    });
    expect(created.status()).toBe(201);
    const body = await created.json() as { memberToken: string; plan: { plan: { id: string } } };
    const planPath = `/plan/${body.plan.plan.id}`;
    const ready = await context.request.patch(`/api/plans/${body.plan.plan.id}`, {
      data: {
        memberToken: body.memberToken, status: "ready",
        context: { nightArea: "piccadilly-soho", daypart: "evening", partyType: "friends", groupSize: 4, budget: "standard" },
      },
    });
    expect(ready.ok()).toBe(true);
    await page.goto(planPath);
    await expect(page.locator(".planRoute__stopsTrack .planRoute__body > strong"))
      .toHaveText(SOHO_FOUR_PUBS.map((pub) => pub.name));
    const walking = page.getByRole("link", { name: "See the walking route", exact: true });
    await expect(walking).toHaveAttribute("href", SOHO_FOUR_MAP_HREF);
    await expect(page.getByRole("navigation", { name: "Site navigation", exact: true })
      .getByRole("link", { name: "Map", exact: true })).toHaveAttribute("href", SOHO_FOUR_MAP_HREF);
    const originalDocument = await page.evaluateHandle(() => document);
    await walking.click();
    await expect(page).toHaveURL(new URL(SOHO_FOUR_MAP_HREF, baseURL!).href);
    expect(await originalDocument.evaluate((original) => original === document)).toBe(true);
    await expectMapLoadingFrameReleased(page);
    await expectMapToolbarReady(page);
    await expect(page.locator(".mapCanvasWrap[data-route-stops]"))
      .toHaveAttribute("data-route-stops", "4", { timeout: 60_000 });
    const originalCanvas = await page.locator(".mapCanvasWrap .maplibregl-canvas").elementHandle();
    expect(originalCanvas).not.toBeNull();

    const readMap = () => page.evaluate((pubs) => {
      const view = window as SohoProbeWindow;
      const camera = view.__pubmaxMapCamera;
      const canvas = document.querySelector<HTMLCanvasElement>(".mapCanvasWrap .maplibregl-canvas");
      if (!camera || !canvas) return null;
      const box = canvas.getBoundingClientRect();
      const points = pubs.map((pub) => ({ id: pub.id, ...camera.project([pub.lng, pub.lat]) }));
      const radius = 21;
      const offsets = [[0, 0], [-radius, 0], [radius, 0], [0, -radius], [0, radius], [-15, -15], [15, -15], [-15, 15], [15, 15]];
      const state = camera.read();
      const loadingOverlayVisible = document.querySelector(".mapLoading") !== null;
      const loadingState = view.__pubmaxPaintedMapTapPoints?.state?.();
      const colourCanvas = document.createElement("canvas");
      colourCanvas.width = colourCanvas.height = 1;
      const colour = colourCanvas.getContext("2d")!;
      colour.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--route-line").trim();
      colour.fillRect(0, 0, 1, 1);
      return {
        // Full-map loading includes background tiles, not route readiness.
        // The pixel and hit assertions below prove the route itself is usable.
        ready: !state.moving && !state.settling && !loadingOverlayVisible
          && loadingState?.sourceLoaded["route-stops"] === true
          && loadingState.sourceLoaded["route-line"] === true,
        loadingOverlayVisible,
        cameraState: state,
        loadingState,
        viewport: { width: innerWidth, height: innerHeight },
        theme: document.documentElement.getAttribute("data-theme"),
        rootFontSize: getComputedStyle(document.documentElement).fontSize,
        canvas: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        points: points.map((point) => ({
          ...point,
          clearRim: offsets.every(([dx, dy]) => document.elementFromPoint(point.x + dx!, point.y + dy!) === canvas),
        })),
        lineColour: Array.from(colour.getImageData(0, 0, 1, 1).data).slice(0, 3),
        lineSamples: pubs.slice(1).map((pub, index) => [0.23, 0.31, 0.42, 0.5, 0.61, 0.73, 0.79]
          .map((fraction) => camera.project([
            pubs[index]!.lng + (pub.lng - pubs[index]!.lng) * fraction,
            pubs[index]!.lat + (pub.lat - pubs[index]!.lat) * fraction,
          ]))),
        span: Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
      };
    }, [...SOHO_FOUR_PUBS]);

    const waitForRouteFrame = () => expect.poll(async () => {
      if (!(await readMap())?.ready) return false;
      await page.evaluate(() => new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      return (await readMap())?.ready;
    }).toBe(true);

    // First observe all responsive states without selecting or dragging.
    for (const viewport of SOHO_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expectLayoutSettled(page.locator(".mapCanvasWrap"));
      await waitForRouteFrame();
      const geometry = await readMap();
      const screenshot = await page.screenshot();
      await testInfo.attach(`four-soho-${theme}-${viewport.name}-geometry`, {
        body: JSON.stringify(geometry, null, 2), contentType: "application/json",
      });
      await testInfo.attach(`four-soho-${theme}-${viewport.name}`, { body: screenshot, contentType: "image/png" });
      expect(await originalCanvas!.evaluate((canvas) => canvas.isConnected
        && canvas === document.querySelector(".mapCanvasWrap .maplibregl-canvas"))).toBe(true);
      expect(geometry).not.toBeNull();
      expect(geometry!.theme).toBe(theme);
      expect(geometry!.viewport).toEqual({ width: viewport.width, height: viewport.height });
      // A short landscape view has less vertical map space. Keep a useful
      // footprint while the independent disc-clearance checks stay in force.
      expect(geometry!.span).toBeGreaterThanOrEqual(Math.min(240, viewport.width * 0.45, viewport.height * 0.5));
      for (const point of geometry!.points) {
        expect(point.clearRim, `${point.id} full disc clears app chrome`).toBe(true);
        expect(point.x).toBeGreaterThanOrEqual(geometry!.canvas.left + 22);
        expect(point.x).toBeLessThanOrEqual(geometry!.canvas.right - 22);
        expect(point.y).toBeGreaterThanOrEqual(geometry!.canvas.top + 22);
        expect(point.y).toBeLessThanOrEqual(geometry!.canvas.bottom - 22);
      }
      for (let first = 0; first < geometry!.points.length; first += 1) {
        for (const other of geometry!.points.slice(first + 1)) {
          const point = geometry!.points[first]!;
          expect(Math.hypot(point.x - other.x, point.y - other.y), "fixed stop centres reserve separate disc space").toBeGreaterThan(40);
        }
      }
      // The independently fixed straight segments must actually paint.
      // The existing three-stop recorded-road case owns pavement geometry.
      const paintedSegments: number[][] = [];
      for (const segment of geometry!.lineSamples) {
        const matchingSamples: number[] = [];
        for (const point of segment) {
          expect(point.x).toBeGreaterThanOrEqual(4);
          expect(point.y).toBeGreaterThanOrEqual(4);
          expect(point.x).toBeLessThan(viewport.width - 4);
          expect(point.y).toBeLessThan(viewport.height - 4);
          const { data } = await sharp(screenshot).extract({ left: Math.round(point.x) - 3,
            top: Math.round(point.y) - 3, width: 7, height: 7 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          let matching = 0;
          for (let offset = 0; offset < data.length; offset += 3) {
            if (geometry!.lineColour.every((channel, index) => Math.abs(data[offset + index]! - channel) < 35)) matching += 1;
          }
          matchingSamples.push(matching);
        }
        paintedSegments.push(matchingSamples);
      }
      await testInfo.attach(`four-soho-${theme}-${viewport.name}-line-pixels`, {
        body: JSON.stringify(paintedSegments), contentType: "application/json",
      });
      // Several positions prevent a valid dash gap at one midpoint reading as
      // an absent line. At least one sampled position must contain painted ink.
      for (const segment of paintedSegments) {
        expect(segment.some((matching) => matching > 2), "the approximate segment visibly paints").toBe(true);
      }
      expect(new URL(page.url()).searchParams.get("pubs")).toBe(SOHO_FOUR_ORDER);
    }

    // Route stops are excluded from the ordinary price-pin probe. Project
    // each fixed stop, then require the real click trace to hit its route disc.
    for (const viewport of SOHO_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expectLayoutSettled(page.locator(".mapCanvasWrap"));
      for (const pub of SOHO_FOUR_PUBS) {
        const recover = page.getByRole("button", { name: /^(?:Recenter route|Show whole walk)$/ });
        await expect(recover).toBeVisible();
        await recover.click();
        try {
          await waitForRouteFrame();
        } catch (error) {
          await testInfo.attach(`recovery-${viewport.name}-${pub.id}`, {
            body: JSON.stringify(await readMap(), null, 2), contentType: "application/json",
          });
          throw error;
        }
        const recovered = await readMap();
        if (!recovered?.loadingState?.loaded) {
          await testInfo.attach(`route-during-tile-loading-${viewport.name}-${pub.id}`, {
            body: JSON.stringify(recovered, null, 2), contentType: "application/json",
          });
        }
        const point = await page.evaluate((pub) => {
          const view = window as SohoProbeWindow;
          view.__pubmaxPaintedMapTapPoints?.trace?.start();
          return view.__pubmaxMapCamera?.project([pub.lng, pub.lat]) ?? null;
        }, pub);
        expect(point, `${pub.id} has a projected route stop`).not.toBeNull();
        await page.mouse.click(point!.x, point!.y);
        try {
          await expect.poll(() => page.evaluate(() => (window as SohoProbeWindow)
            .__pubmaxPaintedMapTapPoints?.trace?.read().clicks.length ?? 0)).toBe(1);
          const trace = await page.evaluate(() => (window as SohoProbeWindow)
            .__pubmaxPaintedMapTapPoints?.trace?.read() ?? null);
          expect(trace?.clicks[0]?.hits).toContainEqual({ layer: "route-stops", venueId: pub.id });
        } catch (error) {
          await testInfo.attach(`missed-click-${viewport.name}-${pub.id}`, {
            body: JSON.stringify({ point, map: await readMap(), trace: await page.evaluate(() =>
              (window as SohoProbeWindow).__pubmaxPaintedMapTapPoints?.trace?.read()) }, null, 2),
            contentType: "application/json",
          });
          await testInfo.attach(`missed-click-${viewport.name}-${pub.id}-view`, {
            body: await page.screenshot(), contentType: "image/png",
          });
          throw error;
        }
        await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe(pub.id);
        const address = page.locator(".venueAddress:visible");
        await expect(address).toHaveCount(1);
        await expect(address).toHaveText(pub.address);
        await testInfo.attach(`four-soho-${theme}-${viewport.name}-${pub.id}`, {
          body: await page.screenshot(), contentType: "image/png",
        });
        const close = page.getByRole("button", { name: "Close pub detail", exact: true });
        await expect(close).toBeVisible();
        await close.click();
        await expect(close).not.toBeVisible();
        expect(new URL(page.url()).searchParams.get("pubs")).toBe(SOHO_FOUR_ORDER);
      }
    }
  });
}
