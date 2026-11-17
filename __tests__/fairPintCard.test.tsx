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
  act(() => slider.dispatchEvent(new Event("pointerup", { bubbles: true })));
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
