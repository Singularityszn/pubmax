// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { fairPence } from "@/lib/fairPintPricing";
import FairPintCard from "@/components/map/fairpint/FairPintCard";
import { FAIR_PINT_KEY, readFairPint, writeFairPint } from "@/lib/fairPint";
import { appliedPintPriceCap, pintPriceCapsFor } from "@/lib/pintPriceCaps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("keeps a drag local, commits exact pence once on release, and abandons cancelled input", () => {
  localStorage.clear();
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  let releases = 0, pounds = 0;
  const props = { start: 550, area: "Soho", counts: () => ({ phase: "ready" as const, count: 4 }), drawCounts: () => ({ phase: "ready" as const, count: 4 }), located: false, locationOff: false, offline: false, onInput: () => {}, onCommit: (pence: number) => { releases++; writeFairPint(pence); pounds = appliedPintPriceCap(pence / 100); }, onLocation: () => {}, onRetry: () => {}, onDraw: () => {}, onClose: () => {} };
  act(() => root.render(createElement(FairPintCard, props)));
  const slider = host.querySelector("input")!;
  act(() => { slider.value = "530"; slider.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(host.querySelector("output")?.textContent).toBe("£5.30");
  expect(localStorage.getItem(FAIR_PINT_KEY)).toBeNull();
  act(() => slider.dispatchEvent(new Event("change", { bubbles: true })));
  expect(readFairPint()).toBe(530);
  expect(pounds).toBe(5.3);
  expect(pintPriceCapsFor(pounds).find((cap) => cap.kind === "custom")?.shortLabel).toBe("£5.30");
  act(() => slider.dispatchEvent(new Event("pointerup", { bubbles: true })));
  expect(releases).toBe(1);
  act(() => { slider.value = "600"; slider.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => slider.dispatchEvent(new Event("pointercancel", { bubbles: true })));
  expect(readFairPint()).toBe(530);
  expect(slider.value).toBe("530");
  act(() => root.unmount()); host.remove(); localStorage.clear();
});

it("publishes the view count while draw-area cells are still pending", async () => {
  const { createSlimShardLoader } = await import("@/lib/slimShards");
  const shards = vi.spyOn(await import("@/lib/slimShards"), "createSlimShardLoader");
  let finishView: (rows: import("@/lib/venuesSlim").SlimVenue[]) => void = () => {};
  let viewReady = false;
  let calls = 0;
  const pending = new Promise<never>(() => {});
  const view = new Promise<import("@/lib/venuesSlim").SlimVenue[]>((resolve) => { finishView = resolve; });
  const loader = createSlimShardLoader("london");
  shards.mockReturnValue({ ...loader, inBounds: () => ++calls === 1 ? view : pending, coverageComplete: () => viewReady });
  const { default: Flow } = await import("@/components/map/fairpint/FairPintFlow");
  const host = document.createElement("div"), mounted = createRoot(host);
  const mark = vi.spyOn(performance, "mark").mockImplementation(() => ({} as PerformanceMark));
  act(() => mounted.render(createElement(Flow, { priceReader: fairPence, mobile: true, cityId: "london", bounds: { west: -0.13, east: -0.12, south: 51.53, north: 51.54 }, center: [-0.125, 51.535], onCommit: () => {}, onRoute: () => {} })));
  await act(async () => { viewReady = true; finishView([{ id: "priced", name: "Listed pub", cheapestPrice: 5, borough: "Camden", lat: 51.535, lng: -0.125, fairPint: [500, "https://www.pint-prices.com/pub/listed", new Date(Date.now() - 86400000).toISOString()] }]); });
  expect(host.textContent).toContain("1 pub in view lists a pint");
  expect(host.textContent).toContain("Checking prices in");
  await vi.dynamicImportSettled();
  act(() => { mounted.unmount(); }); mark.mockRestore(); shards.mockRestore();
});

async function locatedFlow() {
  localStorage.clear();
  const shards = await import("@/lib/slimShards");
  const loader = shards.createSlimShardLoader("london");
  const listed = [500, "https://www.pint-prices.com/pub/listed", new Date(Date.now() - 86400000).toISOString()] as const;
  const rows = [
    { id: "near", name: "Near pub", cheapestPrice: 5, borough: "Islington", lat: 51.5258, lng: -0.0876, fairPint: listed },
    { id: "far", name: "Far pub", cheapestPrice: 5, borough: "Islington", lat: 51.5398, lng: -0.0876, fairPint: listed },
  ];
  // Every distinct box asked for, in order. A view and the draw area always
  // load. The rest are near reads: the margin round a view, or a tapped circle.
  const requested: string[] = [];
  const bounds = { west: -0.1, east: -0.08, south: 51.52, north: 51.545 };
  const views = new Set([JSON.stringify(bounds)]);
  let drawKey: string | undefined;
  const nearRead = (key: string) => !views.has(key) && key !== drawKey;
  // `uncovered` names what the near files have not brought in: everything
  // round the dot, or only the far edge of the margin.
  const control = { uncovered: "none" as "none" | "near" | "edge", holdMargin: null as Promise<void> | null };
  const spy = vi.spyOn(shards, "createSlimShardLoader").mockReturnValue({
    ...loader,
    inBounds: async (box) => {
      const key = JSON.stringify(box);
      if (!requested.includes(key)) requested.push(key);
      await Promise.resolve();
      if (nearRead(key) && control.holdMargin) await control.holdMargin;
      return rows;
    },
    coverageComplete: (box) => {
      // The draw area is the last box of the first pass of reads.
      if (requested.length > 0) drawKey ??= requested[requested.length - 1];
      const key = JSON.stringify(box);
      if (!nearRead(key) || control.uncovered === "none") return true;
      return control.uncovered === "edge" && !requested.includes(key);
    },
  });
  const mark = vi.spyOn(performance, "mark").mockImplementation(() => ({} as PerformanceMark));
  const asked = vi.fn();
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: asked } });
  const { default: Flow } = await import("@/components/map/fairpint/FairPintFlow");
  const reader = { lat: 51.5257, lng: -0.0875, accuracyMeters: 20 };
  const host = document.createElement("div"), mounted = createRoot(host);
  document.body.append(host);
  return {
    asked, control, host, reader, requested,
    render: (readerPosition: typeof reader | null) => act(async () => {
      mounted.render(createElement(Flow, { priceReader: fairPence, mobile: true, cityId: "london", bounds, center: [-0.0875, 51.5257], readerPosition, onCommit: () => {}, onRoute: () => {} }));
    }),
    pan: (view: typeof bounds, readerPosition: typeof reader | null) => act(async () => {
      views.add(JSON.stringify(view));
      mounted.render(createElement(Flow, { priceReader: fairPence, mobile: true, cityId: "london", bounds: view, center: [-0.0875, 51.5257], readerPosition, onCommit: () => {}, onRoute: () => {} }));
    }),
    choice: () => [...host.querySelectorAll("button")].find((button) => /location|in view/i.test(button.textContent ?? ""))!,
    spoken: () => host.querySelector('[aria-live="polite"]')?.textContent,
    done: async () => {
      await vi.dynamicImportSettled();
      act(() => { mounted.unmount(); }); host.remove(); Reflect.deleteProperty(navigator, "geolocation"); mark.mockRestore(); spy.mockRestore(); localStorage.clear();
    },
  };
}

it("counts around a reader position the map already shows, from the same price files, and lets the reader switch back to the view", async () => {
  const { asked, host, reader, requested, render, choice, spoken, done } = await locatedFlow();

  // With no position, only the view and the draw area are read.
  await render(null);
  expect(host.textContent).toContain("2 pubs in view list a pint");
  expect(choice().textContent).toBe("Use my location");
  expect(requested).toHaveLength(2);

  // The dot arrives while the reader's focus is on the location choice. The
  // margin round the view is read once, and it does not depend on the fix.
  const held = choice();
  held.focus();
  await render(reader);
  const before = [...requested];
  expect(before).toHaveLength(3);
  expect(host.textContent).toContain("1 pub within 800 m lists a pint");
  expect(spoken()).toContain("1 pub within 800 m lists a pint");
  expect(choice()).toBe(held);
  expect(document.activeElement).toBe(held);
  expect(held.textContent).toBe("Count pubs in view");

  // A second fix a few metres on asks for no other price file.
  await render({ ...reader, lat: 51.5259 });
  expect(host.textContent).toContain("1 pub within 800 m lists a pint");
  expect(requested).toEqual(before);

  // The reader can go back to the view, and forward again without a new ask.
  await act(async () => choice().click());
  expect(host.textContent).toContain("2 pubs in view list a pint");
  expect(choice().textContent).toBe("Use my location");
  await act(async () => choice().click());
  expect(host.textContent).toContain("1 pub within 800 m lists a pint");
  expect(asked).not.toHaveBeenCalled();
  expect(requested).toEqual(before);

  // A dot off the map leaves the view's own answer and the ask.
  await render({ ...reader, lat: 53.8 });
  expect(host.textContent).toContain("2 pubs in view list a pint");
  expect(choice().textContent).toBe("Use my location");
  expect(requested).toEqual(before);
  await done();
});

it("offers a fix the map holds off screen on a tap, and no later fix moves its request", async () => {
  const { asked, host, reader, requested, render, choice, done } = await locatedFlow();
  const away = { ...reader, lat: 51.56 };
  await render(away);
  expect(host.textContent).toContain("2 pubs in view list a pint");

  await act(async () => choice().click());
  expect(asked).not.toHaveBeenCalled();
  expect(host.textContent).toContain("No pubs within 800 m list a pint");
  expect(choice().textContent).toBe("Count pubs in view");
  const afterTap = [...requested];
  expect(afterTap).toHaveLength(3);

  await render({ ...away, lat: 51.5603 });
  await render({ ...away, lat: 51.57 });
  expect(requested).toEqual(afterTap);
  expect(host.textContent).toContain("No pubs within 800 m list a pint");
  expect(host.textContent).not.toContain("Loading prices");

  // The dot walks on screen and off again. The margin is read once, the
  // tapped circle is still held, and the count never returns to loading.
  await render(reader);
  expect(host.textContent).toContain("1 pub within 800 m lists a pint");
  const withMargin = [...requested];
  expect(withMargin).toHaveLength(4);
  await render({ ...away, lat: 51.57 });
  expect(host.textContent).toContain("No pubs within 800 m list a pint");
  expect(host.textContent).not.toContain("Loading prices");
  expect(requested).toEqual(withMargin);

  // A second ask re-anchors on the newest fix the map holds, still with no
  // geolocation call.
  await act(async () => choice().click());
  await act(async () => choice().click());
  expect(asked).not.toHaveBeenCalled();
  expect(requested).toHaveLength(5);
  expect(JSON.parse(requested[4]!).north).toBeGreaterThan(JSON.parse(afterTap[2]!).north);
  await done();
});

it("publishes the in-view count when a file outside the view fails, and speaks a near count only once it has an answer", async () => {
  const { control, host, reader, render, choice, spoken, done } = await locatedFlow();
  let release!: () => void;
  control.holdMargin = new Promise<void>((resolve) => { release = resolve; });
  control.uncovered = "near";

  await render(null);
  expect(host.textContent).toContain("2 pubs in view list a pint");

  await render(reader);
  expect(host.textContent).toContain("Loading prices");
  expect(spoken()).toBe("");

  await act(async () => { release(); });
  expect(host.textContent).toContain("Could not load prices. Try again.");
  expect(spoken()).toContain("Could not load prices");

  await act(async () => choice().click());
  expect(host.textContent).toContain("2 pubs in view list a pint");
  expect(spoken()).toContain("2 pubs in view list a pint");

  // Back to the near count, which still failed. A retry that works is spoken.
  await act(async () => choice().click());
  expect(spoken()).toContain("Could not load prices");
  control.uncovered = "none";
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click());
  expect(host.textContent).toContain("1 pub within 800 m lists a pint");
  expect(spoken()).toContain("1 pub within 800 m lists a pint");
  await done();
});

it("keeps a near count through a pan and a failed file at the far edge, and speaks a retry after a first load that failed", async () => {
  const { control, host, reader, render, spoken, done, pan } = await locatedFlow();
  // The dot is on screen from the first render, and its files fail.
  control.uncovered = "near";
  await render(reader);
  expect(host.textContent).toContain("Could not load prices. Try again.");
  expect(spoken()).toBe("");
  control.uncovered = "none";
  await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click());
  expect(host.textContent).toContain("1 pub within 800 m lists a pint");
  expect(spoken()).toContain("1 pub within 800 m lists a pint");

  // A pan keeps the dot on screen. Its 800 m are already in, so the count
  // holds while the new margin loads, and holds when its far edge fails.
  let release!: () => void;
  control.holdMargin = new Promise<void>((resolve) => { release = resolve; });
  control.uncovered = "edge";
  await pan({ west: -0.102, east: -0.082, south: 51.52, north: 51.545 }, reader);
  expect(host.textContent).toContain("1 pub within 800 m lists a pint");
  expect(host.textContent).not.toContain("Loading prices");
  await act(async () => { release(); });
  expect(host.textContent).toContain("1 pub within 800 m lists a pint");
  expect(host.textContent).not.toContain("Could not load prices");
  await done();
});

it("starts the deferred planner on Draw and permits retry after refusal", async () => {
  localStorage.clear();
  const shards = await import("@/lib/slimShards");
  const loader = shards.createSlimShardLoader("london");
  const rows = ["one", "two", "three"].map((id) => ({
    id, name: id, cheapestPrice: 5, borough: "Westminster", lat: 51.513, lng: -0.13,
    fairPint: [500, "https://www.pint-prices.com/pub/listed", new Date().toISOString()] as const,
  }));
  const factory = vi.spyOn(shards, "createSlimShardLoader").mockReturnValue({
    ...loader, inBounds: async () => rows, coverageComplete: () => true,
  });
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({ error: { message: "Planner unavailable." } }, { status: 503 }),
  );
  const { default: Flow } = await import("@/components/map/fairpint/FairPintFlow");
  const host = document.createElement("div"), root = createRoot(host);
  const draw = () => [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Draw my night"))!;
  try {
    await act(async () => root.render(<Flow priceReader={fairPence} mobile cityId="london" bounds={{ west: -0.14, east: -0.12, south: 51.50, north: 51.52 }} center={[-0.13, 51.513]} onCommit={() => {}} onRoute={() => {}} />));
    expect(draw().disabled).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    const slider = host.querySelector("input")!;
    act(() => { slider.value = "530"; slider.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { draw().click(); await vi.dynamicImportSettled(); });
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({
      cityId: "london", query: "maximum £5.30 per pint", context: { stopCount: 3 },
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Planner unavailable.");
    expect(host.querySelector("output")?.textContent).toBe("£5.30");
    expect(draw().disabled).toBe(false);
    await act(async () => { draw().click(); });
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount()); factory.mockRestore(); fetcher.mockRestore(); localStorage.clear();
  }
});

it.each(["pan", "retry"])("keeps loaded prices and draw readiness after %s", async (scenario) => {
  const shards = await import("@/lib/slimShards");
  const { offlineCache } = await import("@/lib/offlineCache");
  const loader = shards.createSlimShardLoader("london", { bypassInFlight: true });
  const factory = vi.spyOn(shards, "createSlimShardLoader").mockReturnValue(loader);
  const cached = vi.spyOn(offlineCache, "get").mockResolvedValue(null);
  const mirror = vi.spyOn(offlineCache, "set").mockResolvedValue(true);
  let manifestReads = 0, cellReads = 0;
  let finishCell!: (response: Response) => void;
  const cell = new Promise<Response>((resolve) => { finishCell = resolve; });
  const rows = [1, 2, 3].map((id) => ({
    id: `soho-${id}`, name: `Listed pub ${id}`, cheapestPrice: 5, borough: "Westminster",
    lat: 51.514, lng: -0.13,
    fairPint: [500, "https://www.pint-prices.com/pub/listed", new Date(Date.now() - 86400000).toISOString()],
  }));
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = String(input).split("?")[0];
    if (path === "/data/venues_slim.manifest.json") {
      manifestReads++;
      if (scenario === "retry" && manifestReads === 1) throw new Error("No connection");
      return Response.json({
        version: 2, grid: { originLat: 0, originLon: 0, latStep: 1, lonStep: 1 },
        shards: [
          { id: "soho", core: true, url: "/data/fair-pint-soho.json", count: 3, bbox: [-0.14, 51.50, -0.12, 51.52] },
          { id: "north", core: false, url: "/data/fair-pint-north.json", count: 0, bbox: [-0.14, 51.64, -0.12, 51.67] },
        ],
      });
    }
    if (path === "/data/fair-pint-soho.json") { cellReads++; return cell; }
    if (path === "/data/fair-pint-north.json") return Response.json([]);
    throw new Error(`Unexpected request: ${path}`);
  });
  const { default: Flow } = await import("@/components/map/fairpint/FairPintFlow");
  const host = document.createElement("div"), root = createRoot(host);
  const mark = vi.spyOn(performance, "mark").mockImplementation(() => ({} as PerformanceMark));
  const props = {
    priceReader: fairPence, mobile: true, cityId: "london" as const, center: [-0.13, 51.514] as [number, number],
    bounds: { west: -0.135, east: -0.125, south: 51.51, north: 51.518 },
    onCommit: () => {}, onRoute: () => {},
  };
  const draw = () => [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Draw my night"))!;
  localStorage.clear(); writeFairPint(550);
  try {
    await act(async () => root.render(createElement(Flow, props)));
    if (scenario === "pan") {
      expect(host.textContent).toContain("Loading prices");
      const north = { ...props, bounds: { west: -0.135, east: -0.125, south: 51.65, north: 51.66 }, center: [-0.13, 51.655] as [number, number] };
      await act(async () => root.render(createElement(Flow, north)));
      expect(host.textContent).toContain("No pubs in view");
      await act(async () => finishCell(Response.json(rows)));
      expect(host.textContent).toContain("No pubs in view");
      expect(draw().disabled).toBe(true);
      await act(async () => root.render(createElement(Flow, props)));
    } else {
      expect(host.textContent).toContain("Could not load prices. Try again.");
      expect(draw().disabled).toBe(true);
      const slider = host.querySelector("input")!;
      act(() => { slider.value = "530"; slider.dispatchEvent(new Event("input", { bubbles: true })); });
      act(() => slider.dispatchEvent(new Event("change", { bubbles: true })));
      await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry")!.click());
      await act(async () => finishCell(Response.json(rows)));
      expect(host.querySelector("output")?.textContent).toBe("£5.30");
      expect(readFairPint()).toBe(530);
    }
    expect(host.textContent).toContain("3 pubs in view list a pint");
    expect(draw().disabled).toBe(false);
    expect(cellReads).toBe(1);
    expect(manifestReads).toBe(scenario === "pan" ? 1 : 2);
  } finally {
    await act(async () => { finishCell(Response.json(rows)); root.unmount(); });
    await vi.dynamicImportSettled();
    mark.mockRestore(); fetch.mockRestore(); factory.mockRestore(); cached.mockRestore(); mirror.mockRestore();
    localStorage.clear();
  }
});
it("dismisses for this session when persistent storage rejects the close", async () => {
  const arrival = await import("@/lib/mapFirstVisitArrival");
  localStorage.clear();
  expect(arrival.hasDismissedMapFirstVisitArrival()).toBe(false);
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage full"); });
  arrival.dismissMapFirstVisitArrival(undefined, Date.now(), true);
  expect(arrival.hasDismissedMapFirstVisitArrival()).toBe(true);
  write.mockRestore();
});
it.each(["/map", "/map?utm_source=group-chat", "/map/london?utm_source=group-chat", "/map?max=5.3"])("keeps an early HTML gesture until the live flow takes ownership (%s)", async (path) => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  const { bootFairPintCard, takeEarlyFairPint, validFairPint, FAIR_PINT_INTENT_PARAMS, FAIR_PINT_PATH_PATTERN } = await import("@/lib/fairPint");
  const { searchHasArrivalParam } = await import("@/lib/mapArrivalParams");
  const { BUDGET_CHOICES, BUDGET_KEY, budgetCeiling, writeBudgetChoice } = await import("@/lib/onboardingFlow");
  const { MAP_FIRST_VISIT_ARRIVAL_KEY } = await import("@/lib/mapFirstVisitArrival");
  localStorage.clear(); history.replaceState(null, "", path); writeBudgetChoice("seven");
  const host = document.createElement("aside"); host.dataset.fairPrelude = "true"; host.hidden = true;
  host.innerHTML = '<output></output><input type="range" min="300" max="800" step="10"><button aria-label="Close"></button>';
  document.body.append(host);
  bootFairPintCard({ priceKey: FAIR_PINT_KEY, budgetKey: BUDGET_KEY, dismissalKey: MAP_FIRST_VISIT_ARRIVAL_KEY, changeEvent: "pubmax:map-first-visit-arrival",
    pathPattern: FAIR_PINT_PATH_PATTERN, intentKeys: FAIR_PINT_INTENT_PARAMS, budgets: Object.fromEntries(BUDGET_CHOICES.map(({ id }) => [id, Math.round((budgetCeiling(id) ?? 8) * 100)])) }, validFairPint, searchHasArrivalParam);
  const slider = host.querySelector("input")!;
  expect(host.hidden).toBe(false); expect(slider.value).toBe("700");
  slider.value = "530"; slider.dispatchEvent(new Event("input"));
  expect(host.querySelector("output")?.textContent).toBe("£5.30");
  expect(takeEarlyFairPint()).toBeNull();
  expect(localStorage.getItem(FAIR_PINT_KEY)).toBeNull();
  slider.dispatchEvent(new Event("change"));
  expect(readFairPint()).toBe(530);
  const handoff = takeEarlyFairPint(); expect(handoff).toMatchObject({ pence: 530, releases: 1 });
  expect(takeEarlyFairPint()).toBeNull(); host.remove(); localStorage.clear(); vi.unstubAllEnvs();
});

it("keeps an early release when Close arrives before the controller loads", async () => {
  const { FairPintHost } = await import("@/components/map/fairpint/FairPintHost");
  const { FairPintMapBridge } = await import("@/components/map/fairpint/FairPintBridge");
  const { clearEarlyFairPint } = await import("@/lib/fairPint");
  const native = await import("@/lib/nativeHaptics");
  const haptic = vi.spyOn(native, "haptic").mockResolvedValue(undefined);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("requestIdleCallback", () => 1);
  vi.stubGlobal("cancelIdleCallback", () => {});
  writeFairPint(530);
  window.__pubmaxEarlyFairPint = { pence: 530, releases: 1, closed: true };
  const commit = vi.fn();
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(
      <FairPintHost priceReader={fairPence} cityId="london">
        <FairPintMapBridge bounds={{ west: -0.13, east: -0.12, south: 51.53, north: 51.54 }} center={[-0.125, 51.535]} onCommit={commit} onRoute={() => {}} />
      </FairPintHost>,
    ));
    await vi.dynamicImportSettled();
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith(5.3);
    expect(haptic).toHaveBeenCalledOnce();
    expect(haptic).toHaveBeenCalledWith("selection-kept");
  } finally {
    act(() => root.unmount()); clearEarlyFairPint(); haptic.mockRestore(); vi.unstubAllGlobals();
  }
});

it("authorises the early card script with the dynamic document nonce", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { default: Prelude } = await import("@/components/map/fairpint/FairPintPrelude");
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<Prelude area="Soho" nonce="request-nonce" />);
  expect(host.querySelector("script")?.nonce).toBe("request-nonce");
});

it.each(["release", "cancel", "close"])("waits for an early drag before loading the map, then continues on %s", async (ending) => {
  const { waitForFairPintRelease } = await import("@/components/map/fairpint/FairPintBridge");
  const { MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT } = await import("@/lib/mapFirstVisitArrivalGate");
  const early = { pence: 530, releases: 0, dragging: true, closed: false };
  window.__pubmaxEarlyFairPint = early;
  let loads = 0;
  const loading = waitForFairPintRelease().then(() => { loads++; });
  try {
    await Promise.resolve();
    expect(loads).toBe(0);
    if (ending === "close") early.closed = true;
    else early.dragging = false;
    window.dispatchEvent(new Event(MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT));
    await Promise.resolve();
    expect(loads).toBe(1);
  } finally {
    early.dragging = false;
    window.dispatchEvent(new Event(MAP_FIRST_VISIT_ARRIVAL_CHANGE_EVENT));
    await loading;
    delete window.__pubmaxEarlyFairPint;
  }
});
