// @vitest-environment jsdom

import { act, createElement, useCallback, useLayoutEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useActiveCuratedCrawl, useMapPlanCoordinator } from "@/components/map/pubmap/useMapPlanCoordinator";
import { EMPTY_MAP_SURFACE_STATE, useMapSurfaceNavigation } from "@/components/map/pubmap/useMapSurfaceNavigation";
import { useSelParamSync } from "@/components/map/pubmap/useSelParamSync";
import { CRAWL_URL_DEBOUNCE_MS, useCrawlUrlSync } from "@/components/map/useCrawlUrl";
import { stampMapSurfaceHistory } from "@/lib/mapSurfaceHistory";
import { buildMapSeed } from "@/lib/pubMap";
import { initialFilters } from "@/lib/venues";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Plan = ReturnType<typeof useMapPlanCoordinator>;

// A map seeded once from its arrival address, then handed every later router
// search the way PubMap is while it stays mounted across client navigation.
function usePlan(arrival: string, search: string): Plan {
  const [seed] = useState(() => buildMapSeed(arrival));
  return useMapPlanCoordinator(
    {
      mode: seed.mode,
      builtIds: seed.builtIds,
      routeMapped: seed.routeMapped,
      nightArea: null,
      planningOpen: false,
    },
    search,
  );
}

// The walk as the reader sees it, with the stop edits they can make.
function planView(plan: Plan, ...extra: ReactNode[]) {
  return createElement(
    "div",
    null,
    createElement(
      "output",
      null,
      [plan.mode, plan.routeMapped ? "mapped" : "hidden", plan.builtIds.join(",")].filter(Boolean).join(" "),
    ),
    createElement("button", { type: "button", onClick: () => plan.setRouteMapped(false) }, "Hide route"),
    createElement("button", {
      type: "button",
      onClick: () => {
        plan.setBuiltIds((ids) => [...ids].reverse());
        plan.setRouteMapped(true);
      },
    }, "Reverse route"),
    createElement("button", {
      type: "button",
      onClick: () => {
        plan.setBuiltIds((ids) => ids.slice(0, -1));
        plan.setRouteMapped(true);
      },
    }, "Remove last stop"),
    ...extra,
  );
}

function WalkingRoute({ arrival, search }: { arrival: string; search: string }) {
  return planView(usePlan(arrival, search));
}

// The same map with its own URL sync writing the plan back to the address.
function WrittenWalk({ arrival, search }: { arrival: string; search: string }) {
  const plan = usePlan(arrival, search);
  useCrawlUrlSync(useMemo(
    () => ({ mode: plan.mode, filters: initialFilters, builtIds: plan.builtIds, selectedVenueId: "" }),
    [plan.mode, plan.builtIds],
  ));
  return planView(plan);
}

// The same map holding a pub the reader opened, through its own `?sel=` owner.
function SelectedWalk({ search }: { search: string }) {
  const plan = usePlan("", search);
  const [selectedVenueId, setSelectedVenueId] = useState("");
  const clearSelection = useCallback(() => setSelectedVenueId(""), []);
  useSelParamSync({
    selParam: new URLSearchParams(search).get("sel") ?? "",
    selectedVenueId,
    selectVenue: setSelectedVenueId,
    walkRequest: plan.walkRequest,
    clearSelection,
  });
  const flush = useCrawlUrlSync(useMemo(
    () => ({ mode: plan.mode, filters: initialFilters, builtIds: plan.builtIds, selectedVenueId }),
    [plan.mode, plan.builtIds, selectedVenueId],
  ));
  return planView(
    plan,
    createElement("button", { type: "button", onClick: flush }, "Flush URL"),
    selectedVenueId ? createElement("aside", null, `Showing ${selectedVenueId}`) : null,
    createElement("button", { type: "button", onClick: () => setSelectedVenueId("pub-x") }, "Open pub-x"),
  );
}

// The map's one history owner, with the pub drawer the reader has open.
function VenueTrail({ venueId, landedEntry }: { venueId: string; landedEntry: number }) {
  useMapSurfaceNavigation({
    arrivalSearch: "",
    surfaceId: venueId ? "venue" : "none",
    surfaceTitle: venueId,
    surfaceState: { ...EMPTY_MAP_SURFACE_STATE, venueId },
    selectionHint: "",
    onRestore: () => {},
    onHome: () => {},
    onSurfaceClose: () => {},
    landedEntry,
  });
  return null;
}

const committed: string[] = [];

// The same map with its curated crawl copy, recording each walk and crawl pair
// a reader could see painted.
function CuratedWalk({ arrival, search }: { arrival: string; search: string }) {
  const plan = usePlan(arrival, search);
  const [activeCrawl, setActiveCrawl] = useActiveCuratedCrawl<string>("Soho classic", plan.walkRequest);
  const frame = `${plan.builtIds.join(",")} ${activeCrawl ?? "no crawl"}`;
  useLayoutEffect(() => {
    committed.push(frame);
  }, [frame]);
  return planView(
    plan,
    createElement("button", { type: "button", onClick: () => setActiveCrawl("Riverside") }, "Pick Riverside"),
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

// Each router search settles through act, microtasks included: the map decides
// on a link only after the commit that landed the link's history entry.
async function render(element: ReactElement) {
  await act(async () => root.render(element));
}

it("opens a walking route when its history entry has undefined state", async () => {
  const search = "mode=build&pubs=pub-a,pub-b";
  window.history.replaceState(undefined, "", `/map?${search}`);
  await render(createElement(WalkingRoute, { arrival: search, search }));
  expect(host.querySelector("output")?.textContent).toBe("build mapped pub-a,pub-b");
});

// The router lands a search's entry before it hands the search to the map.
function arrive(search: string, arrival = "") {
  window.history.pushState(null, "", search ? `/map?${search}` : "/map");
  return render(createElement(WalkingRoute, { arrival, search }));
}

function own(search: string, arrival = "") {
  window.history.replaceState(stampMapSurfaceHistory(window.history.state, [], ""), "", `/map?${search}`);
  return render(createElement(WalkingRoute, { arrival, search }));
}

function write(search: string, arrival: string) {
  return render(createElement(WrittenWalk, { arrival, search }));
}

function select(search: string) {
  return render(createElement(SelectedWalk, { search }));
}

function shown() {
  return host.querySelector("output")?.textContent;
}

function drawer() {
  return host.querySelector("aside")?.textContent ?? null;
}

function addressParam(name: string) {
  return new URLSearchParams(window.location.search).get(name);
}

function press(name: string) {
  const button = Array.from(host.querySelectorAll("button")).find((candidate) => candidate.textContent === name);
  if (!button) throw new Error(`No ${name} button`);
  act(() => button.click());
}

function letUrlSyncWrite() {
  act(() => {
    vi.advanceTimersByTime(CRAWL_URL_DEBOUNCE_MS);
  });
}

it("adopts each distinct walking-route link in its order on a map that stays mounted", async () => {
  await arrive("");
  expect(shown()).toBe("suggest hidden");
  await arrive("mode=build&pubs=pub-c,pub-a,pub-b");
  expect(shown()).toBe("build mapped pub-c,pub-a,pub-b");
  await arrive("mode=build&pubs=pub-f,pub-d,pub-e");
  expect(shown()).toBe("build mapped pub-f,pub-d,pub-e");
});

it("keeps a hidden walk hidden through its own selection and query writes", async () => {
  await arrive("");
  await arrive("mode=build&pubs=pub-a,pub-b,pub-c");
  press("Hide route");
  expect(shown()).toBe("build hidden pub-a,pub-b,pub-c");
  await own("mode=build&pubs=pub-a,pub-b,pub-c&sel=pub-b");
  await own("mode=build&q=Soho&pubs=pub-a,pub-b,pub-c&sel=pub-b");
  expect(shown()).toBe("build hidden pub-a,pub-b,pub-c");
});

it("keeps the reader's reversed and shortened stops when the URL sync echoes them", async () => {
  await arrive("");
  await arrive("mode=build&pubs=pub-a,pub-b,pub-c");
  press("Reverse route");
  expect(shown()).toBe("build mapped pub-c,pub-b,pub-a");
  await own("mode=build&pubs=pub-c,pub-b,pub-a");
  expect(shown()).toBe("build mapped pub-c,pub-b,pub-a");
  press("Remove last stop");
  await own("mode=build&pubs=pub-c,pub-b");
  expect(shown()).toBe("build mapped pub-c,pub-b");
  press("Hide route");
  await own("mode=build&pubs=pub-c,pub-b&sel=pub-c");
  expect(shown()).toBe("build hidden pub-c,pub-b");
});

it("maps a hidden walk again when the reader follows its link back from the plan", async () => {
  await arrive("");
  await arrive("mode=build&pubs=pub-a,pub-b");
  press("Hide route");
  await arrive("mode=build&pubs=pub-a,pub-b");
  expect(shown()).toBe("build mapped pub-a,pub-b");
});

it("adopts no link that asks for less than a built walk of two stops", async () => {
  await arrive("");
  const refused = [
    "pubs=pub-a,pub-b",
    "mode=suggest&pubs=pub-a,pub-b",
    "mode=walk&pubs=pub-a,pub-b",
    "mode=build&pubs=pub-a",
    "mode=build&pubs=,,",
    "mode=build",
  ];
  for (const search of refused) {
    await arrive(search);
    expect(shown()).toBe("suggest hidden");
  }
  await arrive("mode=build&pubs=pub-x,pub-y");
  for (const search of refused) {
    await arrive(search);
    expect(shown()).toBe("build mapped pub-x,pub-y");
  }
});

it("draws the router's walk when the map mounted before the address caught up", async () => {
  await arrive("mode=build&pubs=pub-a,pub-b");
  expect(shown()).toBe("build mapped pub-a,pub-b");
});

it("never invents a walk on a bare map", async () => {
  await arrive("");
  await arrive("q=Soho");
  await arrive("q=Soho&sel=pub-a");
  expect(shown()).toBe("suggest hidden");
});

it("leaves a reloaded walk the reader hid hidden", async () => {
  const link = "mode=build&pubs=pub-a,pub-b";
  await arrive(link, link);
  expect(shown()).toBe("build mapped pub-a,pub-b");
  press("Hide route");
  await own(`${link}&sel=pub-a`, link);
  expect(shown()).toBe("build hidden pub-a,pub-b");
});

it("keeps the reader's newest stops when an older write of its own comes back late", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const link = "mode=build&pubs=pub-a,pub-b,pub-c";
  window.history.replaceState(null, "", `/map?${link}`);
  await write(link, link);
  expect(shown()).toBe("build mapped pub-a,pub-b,pub-c");
  press("Reverse route");
  letUrlSyncWrite();
  const reversed = window.location.search;
  expect(addressParam("pubs")).toBe("pub-c,pub-b,pub-a");
  press("Remove last stop");
  press("Hide route");
  expect(shown()).toBe("build hidden pub-c,pub-b");
  await write(reversed, link);
  expect(shown()).toBe("build hidden pub-c,pub-b");
  letUrlSyncWrite();
  expect(addressParam("pubs")).toBe("pub-c,pub-b");
  await write(window.location.search, link);
  await write(reversed, link);
  expect(shown()).toBe("build hidden pub-c,pub-b");
});

it("leaves a walking-route link that lands over a pending write its own walk", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const link = "mode=build&pubs=pub-a,pub-b,pub-c";
  window.history.replaceState(null, "", `/map?${link}`);
  await write(link, link);
  press("Reverse route");
  const next = "mode=build&pubs=pub-f,pub-d,pub-e";
  window.history.pushState(null, "", `/map?${next}`);
  letUrlSyncWrite();
  expect(window.location.search).toBe(`?${next}`);
  await write(next, link);
  expect(shown()).toBe("build mapped pub-f,pub-d,pub-e");
  letUrlSyncWrite();
  expect(addressParam("pubs")).toBe("pub-f,pub-d,pub-e");
  press("Hide route");
  await write(window.location.search, link);
  expect(shown()).toBe("build hidden pub-f,pub-d,pub-e");
  window.history.pushState(null, "", "/plan");
  await write("", link);
  window.history.pushState(null, "", `/map?${next}`);
  await write(next, link);
  expect(shown()).toBe("build mapped pub-f,pub-d,pub-e");
});

it("lets go of a pub left open when a walking-route link names none", async () => {
  await select("");
  press("Open pub-x");
  await select("q=Soho");
  await select("");
  expect(drawer()).toBe("Showing pub-x");
  const link = "mode=build&pubs=pub-a,pub-b,pub-c";
  window.history.pushState(null, "", `/map?${link}`);
  await select(link);
  expect(shown()).toBe("build mapped pub-a,pub-b,pub-c");
  expect(drawer()).toBeNull();
  press("Open pub-x");
  await select(`${link}&sel=pub-x`);
  expect(drawer()).toBe("Showing pub-x");
  expect(shown()).toBe("build mapped pub-a,pub-b,pub-c");
});

it("opens the pub a walking-route link names over the one left open", async () => {
  await select("");
  press("Open pub-x");
  const link = "mode=build&pubs=pub-a,pub-b,pub-c&sel=pub-b";
  window.history.pushState(null, "", `/map?${link}`);
  await select(link);
  expect(shown()).toBe("build mapped pub-a,pub-b,pub-c");
  expect(drawer()).toBe("Showing pub-b");
});

it("makes a landed walk the map's root once the pub left open is let go", async () => {
  window.history.replaceState(null, "", "/map");
  await render(createElement(VenueTrail, { venueId: "", landedEntry: 0 }));
  await render(createElement(VenueTrail, { venueId: "pub-x", landedEntry: 0 }));
  expect(addressParam("sel")).toBe("pub-x");
  window.history.pushState(null, "", "/map?mode=build&pubs=pub-a,pub-b,pub-c");
  await render(createElement(VenueTrail, { venueId: "", landedEntry: 1 }));
  const landed = window.history.length;
  await render(createElement(VenueTrail, { venueId: "pub-x", landedEntry: 1 }));
  expect(window.history.length).toBe(landed + 1);
  expect(addressParam("sel")).toBe("pub-x");
  expect(addressParam("pubs")).toBe("pub-a,pub-b,pub-c");
});

it("keeps a newly landed walk when an older write of its own comes back after it", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const link = "mode=build&pubs=pub-a,pub-b,pub-c";
  window.history.replaceState(null, "", `/map?${link}`);
  await write(link, link);
  press("Reverse route");
  letUrlSyncWrite();
  const reversed = window.location.search;
  expect(addressParam("pubs")).toBe("pub-c,pub-b,pub-a");
  press("Remove last stop");
  const next = "mode=build&pubs=pub-f,pub-d,pub-e";
  window.history.pushState(null, "", `/map?${next}`);
  await write(next, link);
  expect(shown()).toBe("build mapped pub-f,pub-d,pub-e");
  await write(reversed, link);
  expect(shown()).toBe("build mapped pub-f,pub-d,pub-e");
  expect(window.location.search).toBe(`?${next}`);
  letUrlSyncWrite();
  expect(shown()).toBe("build mapped pub-f,pub-d,pub-e");
  expect(addressParam("pubs")).toBe("pub-f,pub-d,pub-e");
  await write(window.location.search, link);
  await write(reversed, link);
  expect(shown()).toBe("build mapped pub-f,pub-d,pub-e");
  expect(addressParam("pubs")).toBe("pub-f,pub-d,pub-e");
});

it("never paints an adopted walk under the curated crawl it replaced, and keeps the reader's next pick", async () => {
  committed.length = 0;
  const link = "mode=build&pubs=pub-a,pub-b";
  window.history.replaceState(null, "", `/map?${link}`);
  await render(createElement(CuratedWalk, { arrival: link, search: link }));
  expect(committed).toEqual(["pub-a,pub-b Soho classic"]);
  const next = "mode=build&pubs=pub-c,pub-d";
  window.history.pushState(null, "", `/map?${next}`);
  await render(createElement(CuratedWalk, { arrival: link, search: next }));
  expect(committed).toEqual(["pub-a,pub-b Soho classic", "pub-c,pub-d no crawl"]);
  press("Pick Riverside");
  await render(createElement(CuratedWalk, { arrival: link, search: `${next}&sel=pub-c` }));
  expect(committed).toEqual(["pub-a,pub-b Soho classic", "pub-c,pub-d no crawl", "pub-c,pub-d Riverside"]);
});

it("consecutive same-walk entries clear the old pub and remap a hidden walk without a stale URL write", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await select("");
  const link = "mode=build&pubs=pub-a,pub-b,pub-c";
  window.history.pushState(null, "", `/map?${link}`);
  await select(link);
  press("Open pub-x");
  press("Hide route");
  window.history.pushState(null, "", `/map?${link}`);
  letUrlSyncWrite();
  press("Flush URL");
  expect(window.location.search).toBe(`?${link}`);
  await select(link);
  expect(shown()).toBe("build mapped pub-a,pub-b,pub-c");
  expect(drawer()).toBeNull();
  letUrlSyncWrite();
  expect(addressParam("sel")).toBeNull();
  press("Open pub-x");
  press("Hide route");
  window.history.replaceState({ externalEntry: 2 }, "", `/map?${link}`);
  await select(link);
  expect(shown()).toBe("build mapped pub-a,pub-b,pub-c");
  expect(drawer()).toBeNull();
});

it("a fresh entry with the same sel parameter restores its pub after a local selection", async () => {
  await select("");
  const link = "mode=build&pubs=pub-a,pub-b&sel=pub-b";
  window.history.pushState(null, "", `/map?${link}`);
  await select(link);
  expect(drawer()).toBe("Showing pub-b");
  press("Open pub-x");
  press("Hide route");
  window.history.pushState(null, "", `/map?${link}`);
  await select(link);
  expect(drawer()).toBe("Showing pub-b");
  expect(shown()).toBe("build mapped pub-a,pub-b");
});
