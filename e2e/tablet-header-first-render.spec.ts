import { expect, test, type Route, type JSHandle } from "@playwright/test";
import { writeFile } from "node:fs/promises";

import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { expectLayoutSettled } from "./helpers/layoutSettled";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";
import { expectMapToolbarReady } from "./helpers/mapToolbar";

test.use({ storageState: { cookies: [], origins: [] } });

// External draft only. Install beside the existing e2e helpers only after review.
// The initial document is real SSR, not fixture-signed-in SSR or device proof.
function createFrameCollector() {
function readLayout() {
  const nav = document.querySelector<HTMLElement>('nav[aria-label="Site navigation"]');
  const toolbar = document.querySelector<HTMLElement>(".mapToolbar");
  const shell = nav?.closest<HTMLElement>(".appShell");
  if (!nav || !toolbar || !shell) return null;
  const rectangle = (node: HTMLElement) => {
    const box = node.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
  };
  const controls = (node: HTMLElement) => Array.from(node.querySelectorAll<HTMLElement>("a[href], button, input"))
    .filter((control) => control.getClientRects().length > 0 && getComputedStyle(control).visibility !== "hidden")
    .map((control) => {
      const box = rectangle(control);
      const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
      return { ...box, name: (control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "").slice(0, 100),
        disabled: control.matches(":disabled"), centreOwned: hit === control || control.contains(hit) };
    });
  const overlaps = (items: ReturnType<typeof controls>) => items.flatMap((first, index) => items.slice(index + 1).flatMap((second) => {
    const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
    const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
    return width > 0.5 && height > 0.5 ? [{ first: first.name, second: second.name, width, height }] : [];
  }));
  const navControls = controls(nav);
  const toolbarControls = controls(toolbar);
  return {
    rootFont: getComputedStyle(document.documentElement).fontSize,
    forcedAttributes: document.querySelectorAll("[data-native-shell], [data-text-scale]").length,
    navDisplay: getComputedStyle(nav).display, toolbarDisplay: getComputedStyle(toolbar).display,
    nav: rectangle(nav), toolbar: rectangle(toolbar), viewportWidth: innerWidth, viewportHeight: innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    measuredInline: shell.style.getPropertyValue("--site-nav-floating-height").trim(),
    computedHeightProperty: getComputedStyle(shell).getPropertyValue("--site-nav-floating-height").trim().slice(0, 160),
    computedClearance: getComputedStyle(shell).getPropertyValue("--map-top-clearance").trim().slice(0, 240),
    navControls, toolbarControls, navOverlaps: overlaps(navControls), toolbarOverlaps: overlaps(toolbarControls),
  };
}

function readBoundary() {
  const state = (selector: string) => {
    const node = document.querySelector<HTMLElement>(selector);
    if (!node) return { present: false, visible: false, display: null, fontSize: null, height: 0, controls: 0 };
    const style = getComputedStyle(node);
    return { present: true, visible: node.getClientRects().length > 0 && style.visibility !== "hidden",
      display: style.display, fontSize: style.fontSize, height: node.getBoundingClientRect().height,
      controls: node.querySelectorAll("a[href], button, input").length };
  };
  return { rootFont: getComputedStyle(document.documentElement).fontSize,
    forcedAttributes: document.querySelectorAll("[data-native-shell], [data-text-scale]").length,
    styleSheetCount: document.styleSheets.length, fontsStatus: document.fonts.status,
    nav: state('nav[aria-label="Site navigation"]'), toolbar: state(".mapToolbar"),
    loadingFrame: state(".mapSkeleton, .mapLoading") };
}

  const samples: Array<{ boundary: ReturnType<typeof readBoundary>; layout: ReturnType<typeof readLayout> }> = [];
  const events: Array<{ reason: string; atMs: number }> = [];
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let failed = false;
  let limitReached = false;
  const record = (reason: string) => events.push({ reason, atMs: Date.now() });
  const stop = (reason: string) => {
    active = false;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    record(reason);
  };
  const collect = () => {
    if (!active) return;
    try {
      samples.push({ boundary: readBoundary(), layout: readLayout() });
      if (samples.length >= 1_200) { limitReached = true; stop("sample_cap"); return; }
      frame = requestAnimationFrame(collect);
    } catch {
      failed = true;
      stop("collector_rejected");
    }
  };
  return {
    readBoundary, readLayout,
    start() {
      active = true;
      record("started");
      timer = setTimeout(() => { limitReached = true; stop("total_expired"); }, 25_000);
      frame = requestAnimationFrame(collect);
    },
    finish() {
      if (active) {
        // Read final readiness atomically before cancelling the outstanding frame.
        try { samples.push({ boundary: readBoundary(), layout: readLayout() }); }
        catch { failed = true; record("final_read_rejected"); }
        stop("readiness_stop");
      }
      return { samples, events, failed, limitReached };
    },
  };
}
type Collector = ReturnType<typeof createFrameCollector>;

test("tablet Map clears its first real header and toolbar through loading at 641px and root32", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 641, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await installAuthDoubles(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-theme", "light");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    // Register before app scripts. No app CSS or clearance variable is replaced.
    let frames = 0;
    const applyRootSize = () => {
      if (document.documentElement) document.documentElement.style.setProperty("font-size", "32px", "important");
      else if (++frames < 12) requestAnimationFrame(applyRootSize);
    };
    applyRootSize();
  });
  await seedSignedIn(page, "A");

  const pattern = /\/_next\/static\/.*\.js(?:\?.*)?$/;
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  let released = false;
  let gateTimedOut = false;
  let blockedCount = 0;
  const waiting = new Set<Route>();
  const routeFailures: string[] = [];
  const release = () => { if (!released) { released = true; releaseGate(); } };
  const timer = setTimeout(() => { gateTimedOut = true; release(); }, 30_000);
  const handler = async (route: Route) => {
    if (route.request().resourceType() !== "script") { await route.continue(); return; }
    blockedCount += 1;
    waiting.add(route);
    try { await gate; await route.continue(); }
    catch { routeFailures.push("chunk_continuation_failed"); }
    finally { waiting.delete(route); }
  };
  const screenshots: string[] = [];
  let initial: ReturnType<Collector["readLayout"]> = null;
  let final: ReturnType<Collector["readLayout"]> = null;
  let initialBoundary: ReturnType<Collector["readBoundary"]> | null = null;
  let samples: Array<{ boundary: ReturnType<Collector["readBoundary"]>; layout: ReturnType<Collector["readLayout"]> }> = [];
  let sampleLimitReached = false;
  let sampleFailure = false;
  let samplerEvents: Array<{ reason: string; atMs: number }> = [];
  let collector: JSHandle<Collector> | null = null;
  let failure: unknown;
  let documentRequests = 0;
  let committedDocumentRequests = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.resourceType() === "document" && request.frame() === page.mainFrame()) documentRequests += 1;
  });
  const assertClearance = (layout: NonNullable<ReturnType<Collector["readLayout"]>>) => {
    expect(layout.rootFont).toBe("32px");
    expect(layout.navDisplay).toBe("flex");
    expect(layout.toolbarDisplay).toBe("flex");
    expect(layout.forcedAttributes).toBe(0);
    expect(layout.toolbar.top).toBeGreaterThanOrEqual(layout.nav.bottom + 12);
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    for (const box of [layout.nav, layout.toolbar]) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(layout.viewportWidth);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(layout.viewportHeight);
    }
  };
  try {
    await page.route(pattern, handler);
    await page.goto("/map", { waitUntil: "commit" });
    committedDocumentRequests = documentRequests;
    const documentHandle = await page.evaluateHandle(() => document);
    try {
      await expect.poll(() => blockedCount, { timeout: 5_000 }).toBeGreaterThan(0);
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("32px");
      await page.evaluate(() => Promise.race([
        document.fonts.ready.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
      ])).then((ready) => expect(ready, "Initial document fonts settled before script release").toBe(true));
      collector = await page.evaluateHandle(createFrameCollector);
      initialBoundary = await collector.evaluate((value) => value.readBoundary());
      initial = await collector.evaluate((value) => value.readLayout());
      expect(gateTimedOut).toBe(false);
      expect(released).toBe(false);
      expect(initialBoundary.rootFont).toBe("32px");
      expect(initialBoundary.forcedAttributes).toBe(0);
      await page.screenshot({ path: testInfo.outputPath("first-render-ssr.png"), timeout: 3_000 });
      screenshots.push("first-render-ssr.png");
      const nav = page.getByRole("navigation", { name: "Site navigation", exact: true });
      const toolbar = page.locator(".mapToolbar");

      // One browser callback reads boundary and layout in the same frame.
      await collector.evaluate((value) => value.start());
      release();
      clearTimeout(timer);
      await expect(nav.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true })).toBeEnabled();
      await expectMapLoadingFrameReleased(page);
      await expectMapToolbarReady(page);
      await expectLayoutSettled(nav);
      await expectLayoutSettled(toolbar);
      final = await collector.evaluate((value) => value.readLayout());
      const collected = await collector.evaluate((value) => value.finish());
      samples = collected.samples;
      samplerEvents = collected.events;
      sampleFailure = collected.failed;
      sampleLimitReached = collected.limitReached;
      await page.screenshot({ path: testInfo.outputPath("first-render-hydrated.png"), timeout: 3_000 });
      screenshots.push("first-render-hydrated.png");
      expect(final).not.toBeNull();
      expect(await documentHandle.evaluate((original) => original === document)).toBe(true);
      expect(documentRequests).toBe(committedDocumentRequests);
      expect(gateTimedOut).toBe(false);
      expect(sampleFailure).toBe(false);
      expect(sampleLimitReached).toBe(false);
      expect(samples.length).toBeGreaterThan(1);
      expect(samples.some((sample) => sample.layout && sample.layout.measuredInline !== "")).toBe(true);
      expect(final!.measuredInline).toMatch(/^\d+px$/);
      expect(Math.abs(Number.parseFloat(final!.measuredInline) - final!.nav.height)).toBeLessThanOrEqual(1);
      let controlsAppeared = false;
      for (const observation of [{ boundary: initialBoundary!, layout: initial }, ...samples, { boundary: await collector.evaluate((value) => value.readBoundary()), layout: final }]) {
        expect(observation.boundary.rootFont).toBe("32px");
        expect(observation.boundary.forcedAttributes).toBe(0);
        const layout = observation.layout;
        if (!layout) {
          expect(controlsAppeared, "real controls do not disappear after their first observed appearance").toBe(false);
          continue;
        }
        controlsAppeared = true;
        assertClearance(layout);
        expect(layout.measuredInline).toMatch(/^\d+px$/);
        expect(Math.abs(Number.parseFloat(layout.measuredInline) - layout.nav.height)).toBeLessThanOrEqual(1);
        expect(layout.navOverlaps).toEqual([]);
        expect(layout.toolbarOverlaps).toEqual([]);
        for (const control of [...layout.navControls, ...layout.toolbarControls]) {
          expect(control.width, `${control.name} width from first appearance`).toBeGreaterThanOrEqual(44);
          expect(control.height, `${control.name} height from first appearance`).toBeGreaterThanOrEqual(44);
          expect(control.centreOwned, `${control.name} hit from first appearance`).toBe(true);
        }
      }
      expect(controlsAppeared).toBe(true);
      expect(final!.navOverlaps).toEqual([]);
      expect(final!.toolbarOverlaps).toEqual([]);
      for (const control of [...final!.navControls, ...final!.toolbarControls]) {
        expect(control.width, `${control.name} width`).toBeGreaterThanOrEqual(44);
        expect(control.height, `${control.name} height`).toBeGreaterThanOrEqual(44);
        expect(control.centreOwned, `${control.name} hit ownership`).toBe(true);
      }
      for (const name of ["Map", "Plan", "Social", "You", "Pub Pal", "Activity", "Messages"]) {
        await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
      }
      await expect(nav.locator('.siteNavLinks a[href="/today"], .siteNavLinks a[href="/tonight"]')).toHaveCount(1);
      await expect(nav.getByRole("link", { name: "Open PUBMAXX landing page", exact: true })).toBeVisible();
      await expect(nav.getByRole("button", { name: "More pages", exact: true })).toBeEnabled();
      await expect(nav.getByRole("button", { name: /Switch to .* theme/ })).toBeEnabled();
    } finally {
      await documentHandle.dispose().catch(() => undefined);
    }
  } catch (error) { failure = error; }
  finally {
    clearTimeout(timer);
    release();
    await page.unroute(pattern, handler).catch(() => { routeFailures.push("unroute_failed"); });
    if (collector) {
      try {
        const collected = await collector.evaluate((value) => value.finish());
        samples = collected.samples;
        samplerEvents = collected.events;
        sampleFailure ||= collected.failed;
        sampleLimitReached ||= collected.limitReached;
      } catch {
        sampleFailure = true;
        samplerEvents.push({ reason: "evaluator_rejected", atMs: Date.now() });
        if (!failure) failure = new Error("First-render sampler evaluator rejected.");
      }
      await collector.dispose();
    }
    const cleanupDeadline = Date.now() + 2_000;
    while (waiting.size && Date.now() < cleanupDeadline) await new Promise((resolve) => setTimeout(resolve, 20));
    if (failure) {
      await page.screenshot({ path: testInfo.outputPath("first-render-failure.png"), timeout: 3_000 })
        .then(() => { screenshots.push("first-render-failure.png"); }).catch(() => undefined);
    }
    await page.close().catch(() => { routeFailures.push("owned_page_close_failed"); });
    const report = { initialBoundary, initial, final, samples, blockedCount, gateTimedOut, routeFailures, pendingRoutes: waiting.size,
      sampleFailure, samplerEvents, sampleLimitReached, committedDocumentRequests, documentRequests,
      scope: "honest SSR/loading presence and compiled CSS, then first real controls through readiness; fixture auth only after hydration; finite rAF samples, not every painted frame" };
    try {
      const output = testInfo.outputPath("first-render.json");
      await writeFile(output, JSON.stringify(report, null, 2));
      await testInfo.attach("first-render", { path: output, contentType: "application/json" });
      for (const name of screenshots) {
        await testInfo.attach(name, { path: testInfo.outputPath(name), contentType: "image/png" });
      }
    } catch {
      if (!failure) failure = new Error("First-render evidence attachment failed.");
    }
    if (!failure && (waiting.size || routeFailures.length)) failure = new Error("Owned first-render gate/page cleanup failed.");
  }
  if (failure) throw failure;
});
