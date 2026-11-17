import { expect, test, type Page } from "@playwright/test";
import { expectSelectedRoutePaint } from "./helpers/routeStopPaint";
import { storeThemeChoice } from "./helpers/themeClock";
import { installNativeShell } from "./helpers/nativeShell";
import { expectLayoutSettled } from "./helpers/layoutSettled";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";
import christmasWalk from "../data/curated-walks/london-christmas.json";
import { writeFile } from "node:fs/promises";
import { fork } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { E2E_SERVER_ENV } from "../playwright.config";

type WalkMeasurements = { inputs: number[]; longTasks: number[]; landmarkMoves: number; supportedTypes: string[]; inputEvents: { name: string; duration: number; startTime: number; target: string | null }[] };
type RouteTapPoint = { id: string; x: number; y: number; selected?: boolean };

const promotionDate = "2026-11-17T15:30:00Z";
const directoryTest = test.extend({
  baseURL: async ({ baseURL: harnessURL }, provide, testInfo) => {
    const server = fork(resolve("scripts/e2e/canonical-price-server.ts"), [promotionDate], {
      execArgv: ["--import", "tsx"],
      env: { ...process.env, ...E2E_SERVER_ENV, ANTHROPIC_API_KEY: "", NODE_ENV: "production" },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    const exited = once(server, "exit");
    try {
      const [ready] = await Promise.race([
        once(server, "message"),
        exited.then(([code]) => { throw new Error(`Christmas walk server exited before readiness (${code}).`); }),
      ]) as [{ baseURL: string; now: number }];
      expect(ready.now).toBe(Date.parse(promotionDate));
      await testInfo.attach("seasonal-directory-server", {
        body: JSON.stringify({ ...ready, ambientBaseURL: harnessURL }), contentType: "application/json",
      });
      await provide(ready.baseURL);
    } finally {
      server.kill();
      await exited;
    }
  },
  storageState: async ({ baseURL }, provide, testInfo) => {
    const state = testInfo.project.use.storageState;
    if (!state || typeof state === "string") throw new Error("The directory requires the harness browser state.");
    await provide({ ...state, origins: state.origins.map((origin) => ({ ...origin, origin: baseURL! })) });
  },
});

test.beforeEach(async ({ page, browserName }) => {
  if (browserName === "webkit") await installNativeShell(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmax:nativeFirstRun:done:v2", "1");
    localStorage.setItem("pubmax-tour-v2-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    const measurements: WalkMeasurements = { inputs: [], longTasks: [], landmarkMoves: 0, supportedTypes: [...PerformanceObserver.supportedEntryTypes], inputEvents: [] };
    Object.assign(window, { __christmasMeasurements: measurements });
    window.addEventListener("pubmax:camera-intent", (event) => {
      if ((event as CustomEvent<{ kind: string }>).detail.kind === "landmark") measurements.landmarkMoves += 1;
    });
    if (PerformanceObserver.supportedEntryTypes.includes("event")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          measurements.inputs.push(entry.duration);
          const target = (entry as PerformanceEntry & { target?: Element }).target;
          measurements.inputEvents.push({ name: entry.name, duration: entry.duration, startTime: entry.startTime,
            target: target?.getAttribute("aria-label") ?? target?.textContent?.trim().slice(0, 80) ?? null });
        }
      }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    }
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver((list) => measurements.longTasks.push(...list.getEntries().map((entry) => entry.duration)))
        .observe({ type: "longtask", buffered: true });
    }
  });
});

async function expectCameraRest(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const probe = (window as typeof window & { __pubmaxMapCamera?: { read(): { moving: boolean; settling: boolean } } }).__pubmaxMapCamera;
    const reading = probe?.read();
    return Boolean(reading && !reading.moving && !reading.settling);
  })).toBe(true);
}

async function expectWholeWalkVisible(page: Page) {
  const geometry = { path: christmasWalk.path, stops: christmasWalk.stops.map((stop) => [stop.longitude, stop.latitude]) };
  await expect.poll(() => page.evaluate(({ path, stops }) => {
    const probe = (window as typeof window & { __pubmaxMapCamera?: { project(point: [number, number]): { x: number; y: number } } }).__pubmaxMapCamera;
    if (!probe) return false;
    const clear = (x: number, y: number) => document.elementFromPoint(x, y)?.tagName === "CANVAS";
    return path.every(([lng, lat]) => { const p = probe.project([lng!, lat!]); return clear(p.x, p.y); })
      && stops.every(([lng, lat]) => { const p = probe.project([lng!, lat!]); return [[-16,-16],[-16,16],[16,-16],[16,16]].every(([x,y]) => clear(p.x+x!, p.y+y!)); });
  }, geometry)).toBe(true);
}

test("a returning map visitor can choose the seasonal walk", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-17T15:30:00Z"));
  await storeThemeChoice(page, "light");
  await page.goto("/map");
  await expectMapLoadingFrameReleased(page);
  if (page.viewportSize()!.width < 768) {
    await page.getByRole("button", { name: "More map controls", exact: true }).click();
    await page.getByRole("tab", { name: "Layers", exact: true }).click();
  }
  await page.getByRole("button", { name: "Plan an outing", exact: true }).click();
  const choice = page.getByRole("button", { name: "Map London Christmas walk with 13 stops", exact: true });
  await choice.click();
  await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "13");
  await expect(page.getByRole("list", { name: "Walking stops in order" })).toBeVisible();
});

test("the map leaves the seasonal walk out before its promotion window", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-14T15:30:00Z"));
  await storeThemeChoice(page, "light");
  await page.goto("/map");
  await expect(page.locator(".mapCanvasWrap")).toBeVisible();
  await expectMapLoadingFrameReleased(page);
  if (page.viewportSize()!.width < 768) {
    await page.getByRole("button", { name: "More map controls", exact: true }).click();
    await page.getByRole("tab", { name: "Layers", exact: true }).click();
  }
  await page.getByRole("button", { name: "Plan an outing", exact: true }).click();
  await expect(page.getByRole("button", { name: "Map London Christmas walk with 13 stops", exact: true })).toHaveCount(0);
});

directoryTest("the crawl directory previews and opens the seasonal walk", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date(promotionDate));
  await storeThemeChoice(page, "light");
  await page.goto("/crawls");
  const link = page.getByRole("link", { name: "Map the Christmas walk", exact: true });
  await expect(page.getByRole("img", { name: "London Christmas walk, 13 numbered stops" })).toBeVisible();
  const shot = testInfo.outputPath("directory.png");
  await page.screenshot({ path: shot });
  await testInfo.attach("directory", { path: shot, contentType: "image/png" });
  await expect(async () => {
    await link.click();
    await expect(page).toHaveURL(/crawl=london-christmas-walk/, { timeout: 1000 });
  }).toPass();
  await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "13");
});

for (const theme of ["light", "dark"] as const) {
  test(`a direct Christmas walk link renders all thirteen stops in ${theme}`, async ({ page, browserName }, testInfo) => {
    await page.clock.setFixedTime(new Date("2027-06-01T15:30:00Z"));
    await storeThemeChoice(page, theme);
    if (browserName === "webkit") await installNativeShell(page);
    await page.goto("/map?mode=build&crawl=london-christmas-walk&style=balanced");
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "13");
    await expect(page).toHaveURL(/crawl=london-christmas-walk/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expectMapLoadingFrameReleased(page);
    await expectCameraRest(page);
    const timing = await page.evaluate(() => ({
      readyMs: performance.now(), routeStops: document.querySelector(".mapCanvasWrap")?.getAttribute("data-route-stops"),
      walkingRequests: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/api/walk-route")).length,
    }));
    expect(timing.walkingRequests).toBe(0);
    const timingPath = testInfo.outputPath("timing.json");
    await writeFile(timingPath, JSON.stringify(timing));
    await testInfo.attach("map-ready-timing", { path: timingPath, contentType: "application/json" });
    await expectWholeWalkVisible(page);
    if (page.viewportSize()!.width < 768) {
      await page.getByRole("button", { name: /^(?:Edit active 13-stop plan|View active 13-stop walk)$/ }).click();
    } else if (page.viewportSize()!.width < 1024) {
      await page.getByRole("button", { name: "View walk", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "View stops", exact: true }).click();
    }
    const panel = page.getByRole("complementary", { name: "London Christmas walk", exact: true });
    const stops = panel.getByRole("list", { name: "Walking stops in order" });
    await expect(page.getByRole("heading", { name: "London Christmas walk", exact: true })).toBeInViewport();
    await expect(stops.getByRole("listitem")).toHaveCount(13);
    await expect(stops.getByRole("button").first()).toContainText("Covent Garden");
    await expect(stops.getByRole("button").last()).toContainText("Trafalgar Square");
    await expectLayoutSettled(stops);
    await expect(stops.getByRole("button").first()).toBeInViewport();
    await expectCameraRest(page);
    await expectWholeWalkVisible(page);
    const stopsShot = testInfo.outputPath(`stops-${theme}.png`);
    await page.screenshot({ path: stopsShot });
    await testInfo.attach(`stops-${theme}`, { path: stopsShot, contentType: "image/png" });
  });
  test(`a Christmas walk keeps focused stops visible in ${theme}`, async ({ page }) => {
    await storeThemeChoice(page, theme);
    await page.goto("/map?mode=build&crawl=london-christmas-walk&style=balanced");
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "13");
    await expectMapLoadingFrameReleased(page);
    await expectCameraRest(page);
    if (page.viewportSize()!.width < 768) await page.getByRole("button", { name: "View active 13-stop walk", exact: true }).click();
    else if (page.viewportSize()!.width < 1024) await page.getByRole("button", { name: "View walk", exact: true }).click();
    else await page.getByRole("button", { name: "View stops", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "London Christmas walk", exact: true });
    const stops = panel.getByRole("list", { name: "Walking stops in order" });
    await expectLayoutSettled(stops);
    await expectCameraRest(page);
    if (page.viewportSize()!.width < 768) {
      await page.locator(".mobileSharedSheetHeader").getByRole("button", { name: "Expand sheet", exact: true }).click();
      await expect(page.locator(".mobileSharedSheetHeader").getByRole("button", { name: "Collapse sheet", exact: true })).toBeVisible();
    }
    for (const index of [0, 5, 12]) {
      const before = await page.evaluate(() => (window as typeof window & { __christmasMeasurements: WalkMeasurements }).__christmasMeasurements.landmarkMoves);
      await stops.getByRole("button").nth(index).click();
      await expect(stops.getByRole("button").nth(index)).toHaveAttribute("aria-current", "step");
      await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "13");
      await expect.poll(() => page.evaluate(() => (window as typeof window & { __christmasMeasurements: WalkMeasurements }).__christmasMeasurements.landmarkMoves)).toBeGreaterThan(before);
      await expectCameraRest(page);
      const stop = christmasWalk.stops[index]!;
      if (index === 5) await expectSelectedRoutePaint(page, [stop.longitude, stop.latitude]);
      await expect.poll(() => page.evaluate((id) => (window as typeof window & {
        __pubmaxPaintedRouteTapPoints?: () => RouteTapPoint[];
      }).__pubmaxPaintedRouteTapPoints?.().some((point) => point.id === id && point.selected) ?? false, stop.id)).toBe(true);
      await expect.poll(() => page.evaluate((point) => {
        const probe = (window as typeof window & { __pubmaxMapCamera?: { project(point: [number, number]): { x: number; y: number } } }).__pubmaxMapCamera;
        const projected = probe?.project(point);
        return Boolean(projected && document.elementFromPoint(projected.x, projected.y)?.closest(".maplibreMap"));
      }, [stop.longitude, stop.latitude] as [number, number])).toBe(true);
    }
  });
  test(`a Christmas walk supports map selection and sharing in ${theme}`, async ({ page, context, browserName }, testInfo) => {
    if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await storeThemeChoice(page, theme);
    await page.goto("/map?mode=build&crawl=london-christmas-walk&style=balanced");
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "13");
    await expectMapLoadingFrameReleased(page);
    await expectCameraRest(page);
    const panel = page.getByRole("complementary", { name: "London Christmas walk", exact: true });
    const stops = panel.getByRole("list", { name: "Walking stops in order" });
    await page.locator(".mapCanvasWrap").getByRole("button", { name: "Show whole walk", exact: true }).click();
    await expectCameraRest(page);
    await expectWholeWalkVisible(page);
    const painted = () => page.evaluate(() => (window as typeof window & {
      __pubmaxPaintedRouteTapPoints?: () => RouteTapPoint[];
    }).__pubmaxPaintedRouteTapPoints?.().find((point) => point.id !== "christmas-13") ?? null);
    const tap: { current: RouteTapPoint | null } = { current: null };
    await expect.poll(async () => { tap.current = await painted(); return Boolean(tap.current); }).toBe(true);
    const target = tap.current!;
    if (testInfo.project.use.hasTouch) await page.touchscreen.tap(target.x, target.y);
    else await page.mouse.click(target.x, target.y);
    const targetIndex = christmasWalk.stops.findIndex((stop) => stop.id === target.id);
    await expect.poll(() => page.evaluate(() => (window as typeof window & {
      __pubmaxMapCamera?: { read(): { zoom: number } };
    }).__pubmaxMapCamera?.read().zoom ?? 0)).toBeGreaterThanOrEqual(15.5);
    await expectCameraRest(page);
    const selectedStop = christmasWalk.stops[targetIndex]!;
    await expectSelectedRoutePaint(page, [selectedStop.longitude, selectedStop.latitude]);
    await expect(panel).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`closed-selection-${theme}.png`) });
    if (page.viewportSize()!.width < 768) await page.getByRole("button", { name: "View active 13-stop walk", exact: true }).click();
    else if (page.viewportSize()!.width < 1024) await page.getByRole("button", { name: "View walk", exact: true }).click();
    else await page.getByRole("button", { name: "View stops", exact: true }).click();
    await expect(stops.getByRole("button").nth(targetIndex)).toHaveAttribute("aria-current", "step");
    await panel.getByRole("button", { name: "Copy walk link", exact: true }).click();
    await expect(panel.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
    if (browserName === "chromium") {
      const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
      expect(copied.searchParams.get("crawl")).toBe("london-christmas-walk");
    }
  });
  test(`a Christmas walk can be hidden, restored and left in ${theme}`, async ({ page }, testInfo) => {
    await storeThemeChoice(page, theme);
    await page.goto("/map?mode=build&crawl=london-christmas-walk&style=balanced");
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "13");
    await expectMapLoadingFrameReleased(page);
    await expectCameraRest(page);
    if (page.viewportSize()!.width < 768) await page.getByRole("button", { name: "View active 13-stop walk", exact: true }).click();
    else if (page.viewportSize()!.width < 1024) await page.getByRole("button", { name: "View walk", exact: true }).click();
    else await page.getByRole("button", { name: "View stops", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "London Christmas walk", exact: true });
    const stops = panel.getByRole("list", { name: "Walking stops in order" });
    await expectLayoutSettled(stops);
    await expectCameraRest(page);
    await panel.getByRole("button", { name: "Hide walking route", exact: true }).click();
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "0");
    await panel.getByRole("button", { name: "Show walking route", exact: true }).click();
    await expect(page.locator(".mapCanvasWrap[data-route-stops]")).toHaveAttribute("data-route-stops", "13");
    if (page.viewportSize()!.width < 768) await page.getByRole("button", { name: "View active 13-stop walk", exact: true }).click();
    await panel.getByRole("button", { name: "Plan something else", exact: true }).click();
    await expect(page.getByRole("list", { name: "Walking stops in order" })).toHaveCount(0);
    await expect(page).not.toHaveURL(/crawl=london-christmas-walk/);
    const interactionPath = testInfo.outputPath("interactions.json");
    await writeFile(interactionPath, JSON.stringify(await page.evaluate(() => (window as typeof window & {
      __christmasMeasurements?: WalkMeasurements;
    }).__christmasMeasurements)));
    await testInfo.attach("interaction-timings", { path: interactionPath, contentType: "application/json" });
  });
}
