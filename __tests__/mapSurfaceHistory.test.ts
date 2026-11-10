import { describe, expect, it } from "vitest";

import {
  MAP_SURFACE_HISTORY_KEY,
  mapSurfaceOpenTransition,
  readMapSurfaceHistory,
  stampMapSurfaceHistory,
} from "@/lib/mapSurfaceHistory";
import { backSurface, openSurface, type SurfaceEntry, type SurfaceStack } from "@/lib/surfaceStack";
import { mergeCrawlUrlSearch } from "@/components/map/useCrawlUrl";

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

// Models the hook's browser history: index 0 is the root entry, and each open
// pushes or replaces one stamped entry, as `commitOpen` does.
function replayOpens(...opened: SurfaceEntry<Held>[]) {
  let stack: SurfaceStack<Held> = [];
  const entries = [stampMapSurfaceHistory(null, stack, "")];
  const kinds: string[] = [];
  for (const entry of opened) {
    const transition = mapSurfaceOpenTransition(stack, entry);
    stack = transition.stack;
    kinds.push(transition.kind);
    const state = stampMapSurfaceHistory(entries.at(-1), stack, "");
    if (transition.kind === "push") entries.push(state);
    else entries[entries.length - 1] = state;
  }
  return { stack, kinds, entries, top: entries.length - 1 };
}

describe("characterisation: map surface open, back, home and reorder", () => {
  it("today: open pushes one entry per new surface and replaces a reopened top", () => {
    const run = replayOpens(planner, venue, { ...venue, state: { venueId: "venue-harp", tab: "overview" } });
    expect(run.kinds).toEqual(["push", "push", "replace"]);
    expect(run.stack.map((entry) => entry.id)).toEqual(["planner", "venue"]);
    expect(run.top).toBe(run.stack.length);
  });

  it("today: without a reorder, Back and Home land where the stack says", () => {
    const run = replayOpens(planner, venue);
    const back = readMapSurfaceHistory<Held>(run.entries[run.top - 1]);
    expect(back).toEqual(backSurface(run.stack));
    const home = readMapSurfaceHistory<Held>(run.entries[run.top - run.stack.length]);
    expect(home).toEqual([]);
  });

  it("today: reorder pushes a browser entry, so stack depth 2 sits on 3 entries above root (R3)", () => {
    const run = replayOpens(planner, venue, planner);
    expect(run.kinds).toEqual(["push", "push", "push"]);
    expect(run.stack).toEqual([venue, planner]);
    expect(run.stack.length).toBe(2);
    expect(run.top).toBe(3);
    expect(openSurface([planner, venue], planner)).toEqual([planner]);
  });

  it("today: Home after a reorder goes back by stack depth and lands on the planner entry, not root (R3)", () => {
    const run = replayOpens(planner, venue, planner);
    const landed = run.top - run.stack.length;
    expect(landed).toBe(1);
    expect(readMapSurfaceHistory<Held>(run.entries[landed])).toEqual([planner]);
  });

  it("today: Back after a reorder restores the pre-reorder trail, not backSurface (R3)", () => {
    const run = replayOpens(planner, venue, planner);
    expect(readMapSurfaceHistory<Held>(run.entries[run.top - 1])).toEqual([planner, venue]);
    expect(backSurface(run.stack)).toEqual([venue]);
  });
});
