// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAP_SURFACE_HISTORY_KEY,
  mapSurfaceOpenTransition,
  readEntriesAboveRoot,
  readMapSurfaceHistory,
  stampMapSurfaceHistory,
} from "@/lib/mapSurfaceHistory";
import { backSurface, openSurface, type SurfaceEntry, type SurfaceStack } from "@/lib/surfaceStack";
import { buildMapSeed } from "@/lib/pubMap";
import { shouldOpenPlanningInitially } from "@/lib/mapArrival";
import { mergeCrawlUrlSearch } from "@/components/map/useCrawlUrl";
import {
  EMPTY_MAP_SURFACE_STATE,
  useMapSurfaceNavigation,
  type MapSurfaceState,
} from "@/components/map/pubmap/useMapSurfaceNavigation";

type Held = { venueId: string; tab: string };

const planner = {
  id: "planner",
  title: "Plan an outing",
  state: { venueId: "", tab: "route" },
};
const venue = {
  id: "venue",
  title: "The French House",
  state: { venueId: "venue-french-house", tab: "pints" },
};

describe("Map surface history snapshot", () => {
  it("stamps full trail and venue sentinel under one owner state", () => {
    const stack: SurfaceStack<Held> = [planner, venue];

    expect(
      stampMapSurfaceHistory(
        { __NA: true, pubmaxSurfaceDepth: 2 },
        stack,
        "venue-french-house",
      ),
    ).toEqual({
      __NA: true,
      [MAP_SURFACE_HISTORY_KEY]: {
        version: 1,
        stack,
        aboveRoot: 2,
      },
      pubmaxSelection: 1,
      venueId: "venue-french-house",
    });
  });

  it("clears a stale venue sentinel when planner or Map owns entry", () => {
    const state = stampMapSurfaceHistory(
      {
        __NA: true,
        pubmaxSelection: 1,
        venueId: "stale-venue",
      },
      [planner],
      "",
    );

    expect(state).toEqual({
      __NA: true,
      [MAP_SURFACE_HISTORY_KEY]: {
        version: 1,
        stack: [planner],
        aboveRoot: 1,
      },
    });
  });

  it("reads valid owner snapshots and rejects malformed external state", () => {
    const valid = {
      [MAP_SURFACE_HISTORY_KEY]: {
        version: 1,
        stack: [planner, venue],
      },
    };

    expect(readMapSurfaceHistory<Held>(valid)).toEqual([planner, venue]);
    expect(readMapSurfaceHistory(null)).toBeNull();
    expect(
      readMapSurfaceHistory({
        [MAP_SURFACE_HISTORY_KEY]: {
          version: 1,
          stack: [{ id: 4, title: "broken" }],
        },
      }),
    ).toBeNull();
    expect(
      readMapSurfaceHistory({
        [MAP_SURFACE_HISTORY_KEY]: {
          version: 2,
          stack: [],
        },
      }),
    ).toBeNull();
  });
});

describe("Map surface URL ownership", () => {
  it("preserves landed selection against a stale crawl-state write", () => {
    expect(
      mergeCrawlUrlSearch(
        "q=The+French+House",
        "?q=The+French+House&sel=venue-french-house",
      ),
    ).toBe("q=The+French+House&sel=venue-french-house");
  });
});

describe("Map surface open decision", () => {
  it("pushes a surface not yet in trail", () => {
    expect(mapSurfaceOpenTransition([planner], venue)).toEqual({
      kind: "push",
      stack: [planner, venue],
    });
  });

  it("replaces current venue without adding Back depth", () => {
    const nextVenue = {
      ...venue,
      title: "The Harp",
      state: { venueId: "venue-harp", tab: "overview" },
    };

    expect(mapSurfaceOpenTransition([planner, venue], nextVenue)).toEqual({
      kind: "replace",
      stack: [planner, nextVenue],
    });
  });

  it("keeps the landmark story as the parent of a pub opened out of it", () => {
    // verify-preview-4, J02: Back from The White Lion, opened from the Covent
    // Garden story, landed on a bare map. The story is a trail surface now.
    const story = {
      id: "landmark",
      title: "Covent Garden",
      state: { venueId: "", tab: "", landmarkId: "covent-garden" },
    };
    expect(mapSurfaceOpenTransition([story], venue)).toEqual({
      kind: "push",
      stack: [story, venue],
    });
  });

  it("writes a fresh entry when reopening a known parent", () => {
    expect(mapSurfaceOpenTransition([planner, venue], planner)).toEqual({
      kind: "push",
      stack: [venue, planner],
    });
  });
});

describe("characterisation: map surface open, back, home and reorder", () => {
  let root: Root;
  let container: HTMLDivElement;
  let navigation: ReturnType<typeof useMapSurfaceNavigation>;
  const onRestore = vi.fn();
  const onHome = vi.fn();

  function Harness({ selectionHint = "" }: { selectionHint?: string }) {
    navigation = useMapSurfaceNavigation({
      arrivalSearch: "",
      surfaceId: "none",
      surfaceTitle: "",
      surfaceState: EMPTY_MAP_SURFACE_STATE,
      selectionHint,
      onRestore,
      onHome,
      onSurfaceClose: () => {},
    });
    return null;
  }

  function openSurfaces(...entries: SurfaceEntry<Held>[]) {
    act(() => {
      for (const entry of entries) {
        navigation.open({
          ...entry,
          state: {
            ...EMPTY_MAP_SURFACE_STATE,
            venueId: entry.state?.venueId ?? "",
            venueTab: entry.state?.tab ?? "",
          },
        });
      }
    });
  }

  function trail() {
    return readMapSurfaceHistory<MapSurfaceState>(window.history.state);
  }

  async function traverse(action: () => void) {
    await act(async () => {
      const landed = new Promise<void>((resolve) => {
        window.addEventListener("popstate", () => resolve(), { once: true });
      });
      action();
      await landed;
    });
  }

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onRestore.mockClear();
    onHome.mockClear();
    window.history.replaceState(null, "", "/map");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root.render(createElement(Harness)); });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("today: open pushes one entry per new surface and replaces a reopened top", () => {
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    openSurfaces(planner, venue, { ...venue, state: { venueId: "venue-harp", tab: "overview" } });
    expect(push).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(trail()?.map((entry) => entry.id)).toEqual(["planner", "venue"]);
    expect(trail()?.at(-1)?.state?.venueId).toBe("venue-harp");
    expect(readEntriesAboveRoot(window.history.state)).toBe(2);
  });

  it("today: Back restores the planner after opening a venue", async () => {
    openSurfaces(planner, venue);
    await traverse(() => navigation.back());
    expect(trail()?.map((entry) => entry.id)).toEqual(["planner"]);
    expect(onRestore).toHaveBeenLastCalledWith(expect.objectContaining({ id: "planner" }));
  });

  it.each(["", "53.4808,-2.2426"])("keeps a pub's at= hint on Back from Plan with outgoing hint %j", async (selectionHint) => {
    await act(async () => root.render(createElement(Harness, { selectionHint: "51.5003,-0.2218" })));
    openSurfaces(venue);
    const venueUrl = window.location.href;
    await act(async () => root.render(createElement(Harness, { selectionHint })));
    openSurfaces(planner);

    await traverse(() => navigation.back());

    expect(window.location.href).toBe(venueUrl);
    expect(new URLSearchParams(window.location.search).get("at")).toBe("51.5003,-0.2218");
    expect(onRestore).toHaveBeenLastCalledWith(expect.objectContaining({ id: "venue" }));
  });

  it("keeps a pub's at= hint on Forward from Plan", async () => {
    openSurfaces(planner);
    await act(async () => root.render(createElement(Harness, { selectionHint: "53.4808,-2.2426" })));
    openSurfaces(venue);
    const venueUrl = window.location.href;
    await traverse(() => navigation.back());
    await act(async () => root.render(createElement(Harness, { selectionHint: "51.5003,-0.2218" })));

    await traverse(() => window.history.forward());

    expect(window.location.href).toBe(venueUrl);
    expect(new URLSearchParams(window.location.search).get("at")).toBe("53.4808,-2.2426");
    expect(onRestore).toHaveBeenLastCalledWith(expect.objectContaining({ id: "venue" }));
  });

  it("today: reorder pushes a browser entry, so stack depth 2 sits on 3 entries above root (R3)", () => {
    const push = vi.spyOn(window.history, "pushState");
    openSurfaces(planner, venue, planner);
    expect(push).toHaveBeenCalledTimes(3);
    expect(trail()?.map((entry) => entry.id)).toEqual(["venue", "planner"]);
    expect(readEntriesAboveRoot(window.history.state)).toBe(3);
    expect(openSurface([planner, venue], planner)).toEqual([planner]);
  });

  it.each([
    { label: "ordinary opens", entries: [planner, venue] },
    { label: "a reorder", entries: [planner, venue, planner] },
  ])("today: Home returns to the map root after $label", async ({ entries }) => {
    openSurfaces(...entries);
    await traverse(() => navigation.home());
    expect(trail()).toEqual([]);
    expect(readEntriesAboveRoot(window.history.state)).toBe(0);
    expect(window.location.pathname + window.location.search).toBe("/map");
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenLastCalledWith(null);
    expect(navigation.holdsSurface("planner")).toBe(false);
    expect(navigation.holdsSurface("venue")).toBe(false);
  });

  it("today: Back after a reorder restores the pre-reorder trail, not backSurface (R3)", async () => {
    openSurfaces(planner, venue, planner);
    await traverse(() => navigation.back());
    expect(trail()?.map((entry) => entry.id)).toEqual(["planner", "venue"]);
    expect(onRestore).toHaveBeenLastCalledWith(expect.objectContaining({ id: "venue" }));
    expect(readEntriesAboveRoot(window.history.state)).toBe(2);
    expect(backSurface([venue, planner])).toEqual([venue]);
  });
});

describe("the planner deep link (plan=1) lives only on an entry that shows the planner", () => {
  let root: Root;
  let container: HTMLDivElement;
  let navigation: ReturnType<typeof useMapSurfaceNavigation>;
  const arrival = "/map?mode=build&plan=1&style=heritage&max=6";
  const plannerState = { ...EMPTY_MAP_SURFACE_STATE };

  function Harness() {
    const [search] = useState(() => window.location.search);
    const [seed] = useState(() => buildMapSeed(search));
    const surfaceId = seed.selectedVenueId ? "venue"
      : shouldOpenPlanningInitially(seed.mode, search) ? "planner"
        : seed.landmarkId ? "landmark" : "none";
    const [state] = useState(() => ({ ...plannerState, venueId: seed.selectedVenueId, landmarkId: seed.landmarkId ?? "" }));
    navigation = useMapSurfaceNavigation({
      arrivalSearch: search,
      surfaceId,
      surfaceTitle: surfaceId,
      surfaceState: state,
      selectionHint: "",
      onRestore: () => {},
      onHome: () => {},
      onSurfaceClose: () => {},
    });
    return null;
  }

  async function reload(shared = false) {
    await act(async () => root.unmount());
    if (shared) window.history.replaceState(null, "", window.location.href);
    root = createRoot(container);
    await act(async () => root.render(createElement(Harness)));
  }

  function expectPlannerClosed() {
    const seed = buildMapSeed(window.location.search);
    expect(shouldOpenPlanningInitially(seed.mode, window.location.search)).toBe(false);
  }

  const address = () => `${window.location.pathname}${window.location.search}`;
  const trail = () => readMapSurfaceHistory<MapSurfaceState>(window.history.state)?.map((entry) => entry.id);

  function open(entry: { id: string; title: string; venueId?: string; landmarkId?: string }) {
    act(() => {
      navigation.open({
        id: entry.id as never,
        title: entry.title,
        state: { ...EMPTY_MAP_SURFACE_STATE, venueId: entry.venueId ?? "", landmarkId: entry.landmarkId ?? "" },
      });
    });
  }

  async function back() {
    await act(async () => {
      const landed = new Promise<void>((resolve) => {
        window.addEventListener("popstate", () => resolve(), { once: true });
      });
      navigation.back();
      await landed;
    });
  }

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.history.replaceState(null, "", arrival);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root.render(createElement(Harness)); });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps the arrival address on the planner entry and leaves plan=1 off the map root", async () => {
    expect(trail()).toEqual(["planner"]);
    expect(address()).toBe(arrival);
    await back();
    expect(trail()).toEqual([]);
    expect(new URLSearchParams(window.location.search).has("plan")).toBe(false);
    expectPlannerClosed();
    expect(new URLSearchParams(window.location.search).get("max")).toBe("6");
    await reload();
    expect(trail()).toEqual([]);
  });

  it("drops plan=1 from a pub opened over the planner, so closing a reopened planner back to it stays shut", async () => {
    open({ id: "venue", title: "The French House", venueId: "venue-french-house" });
    expect(new URLSearchParams(window.location.search).get("sel")).toBe("venue-french-house");
    expect(new URLSearchParams(window.location.search).has("plan")).toBe(false);
    open({ id: "planner", title: "Plan an outing" });
    expect(trail()).toEqual(["venue", "planner"]);
    await back();
    expect(trail()).toEqual(["planner", "venue"]);
    expect(new URLSearchParams(window.location.search).has("plan")).toBe(false);
    expect(new URLSearchParams(window.location.search).get("sel")).toBe("venue-french-house");
    expectPlannerClosed();
    await reload(true);
    expect(trail()).toEqual(["venue"]);
  });

  it("drops plan=1 from a landmark story opened over the planner, and Back returns to the planner's address", async () => {
    open({ id: "landmark", title: "Big Ben", landmarkId: "big-ben" });
    expect(trail()).toEqual(["planner", "landmark"]);
    expect(new URLSearchParams(window.location.search).get("landmark")).toBe("big-ben");
    expectPlannerClosed();
    expect(new URLSearchParams(window.location.search).has("plan")).toBe(false);
    await back();
    expect(trail()).toEqual(["planner"]);
    expect(address()).toBe(arrival);
  });

  it("shares and reloads the landmark URL over the planner without reopening the planner (issue 2711)", async () => {
    open({ id: "landmark", title: "Big Ben", landmarkId: "big-ben" });
    await reload(true);
    expect(trail()).toEqual(["landmark"]);
    expect(buildMapSeed(window.location.search).landmarkId).toBe("big-ben");
    expectPlannerClosed();
  });

});
