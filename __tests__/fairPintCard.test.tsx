// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
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
  act(() => mounted.render(createElement(Flow, { mobile: true, cityId: "london", bounds: { west: -0.13, east: -0.12, south: 51.53, north: 51.54 }, center: [-0.125, 51.535], onCommit: () => {}, onRoute: () => {} })));
  await act(async () => { viewReady = true; finishView([{ id: "priced", name: "Listed pub", cheapestPrice: 5, borough: "Camden", lat: 51.535, lng: -0.125, fairPint: [500, "https://www.pint-prices.com/pub/listed", new Date(Date.now() - 86400000).toISOString()] }]); });
  expect(host.textContent).toContain("1 pubs in view list a pint");
  expect(host.textContent).toContain("Checking prices in");
  await vi.dynamicImportSettled();
  act(() => { mounted.unmount(); }); mark.mockRestore(); shards.mockRestore();
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
  const { bootFairPintCard, takeEarlyFairPint, validFairPint } = await import("@/lib/fairPint");
  const { BUDGET_CHOICES, BUDGET_KEY, budgetCeiling, writeBudgetChoice } = await import("@/lib/onboardingFlow");
  const { MAP_FIRST_VISIT_ARRIVAL_KEY } = await import("@/lib/mapFirstVisitArrival");
  localStorage.clear(); history.replaceState(null, "", path); writeBudgetChoice("seven");
  const host = document.createElement("aside"); host.dataset.fairPrelude = "true"; host.hidden = true;
  host.innerHTML = '<output></output><input type="range" min="300" max="800" step="10"><button aria-label="Close"></button>';
  document.body.append(host);
  bootFairPintCard({ priceKey: FAIR_PINT_KEY, budgetKey: BUDGET_KEY, dismissalKey: MAP_FIRST_VISIT_ARRIVAL_KEY, changeEvent: "pubmax:map-first-visit-arrival",
    budgets: Object.fromEntries(BUDGET_CHOICES.map(({ id }) => [id, Math.round((budgetCeiling(id) ?? 8) * 100)])) }, validFairPint);
  const slider = host.querySelector("input")!;
  expect(host.hidden).toBe(false); expect(slider.value).toBe("700");
  slider.value = "530"; slider.dispatchEvent(new Event("input"));
  expect(host.querySelector("output")?.textContent).toBe("£5.30");
  expect(takeEarlyFairPint()).toBeNull();
  expect(localStorage.getItem(FAIR_PINT_KEY)).toBeNull();
  slider.dispatchEvent(new Event("change"));
  expect(readFairPint()).toBe(530);
  const handoff = takeEarlyFairPint(); expect(handoff).toMatchObject({ pence: 530, releases: 1 });
  expect(takeEarlyFairPint()).toBeNull(); host.remove(); localStorage.clear();
});

it("keeps an early release when Close arrives before the controller loads", async () => {
  const { FairPintHost, FairPintMapBridge } = await import("@/components/map/fairpint/FairPintHost");
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
      <FairPintHost cityId="london">
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
