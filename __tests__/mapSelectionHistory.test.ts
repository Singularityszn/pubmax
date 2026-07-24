import { describe, it, expect } from "vitest";

import {
  browseSelectionUrl,
  cleanMapUrl,
  isSelectionSentinel,
  PUBMAX_SELECTION_SENTINEL,
  searchHasSelection,
  selectionSentinel,
  selectionSentinelVenueId,
  selectionTransition,
  withSelectionSentinel,
} from "@/lib/mapSelectionHistory";

describe("selection sentinel guards", () => {
  it("recognises a well-formed sentinel", () => {
    const state = selectionSentinel("venue-abc");
    expect(state).toEqual({ pubmaxSelection: PUBMAX_SELECTION_SENTINEL, venueId: "venue-abc" });
    expect(isSelectionSentinel(state)).toBe(true);
    expect(selectionSentinelVenueId(state)).toBe("venue-abc");
  });

  it("rejects null, foreign, and malformed state", () => {
    expect(isSelectionSentinel(null)).toBe(false);
    expect(isSelectionSentinel(undefined)).toBe(false);
    expect(isSelectionSentinel({ pubmaxSelection: 1 })).toBe(false); // missing venueId
    expect(isSelectionSentinel({ pubmaxSelection: 2, venueId: "x" })).toBe(false);
    expect(isSelectionSentinel({ venueId: "x" })).toBe(false);
    expect(selectionSentinelVenueId({ foo: "bar" })).toBeNull();
  });
});

describe("withSelectionSentinel", () => {
  it("merges the sentinel onto existing router state, preserving foreign keys", () => {
    const nextState = { __PRIVATE_NEXTJS_INTERNALS_TREE: { some: "tree" }, key: "abc" };
    const merged = withSelectionSentinel(nextState, "venue-xyz");
    expect(merged.pubmaxSelection).toBe(PUBMAX_SELECTION_SENTINEL);
    expect(merged.venueId).toBe("venue-xyz");
    expect(merged.__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual({ some: "tree" });
    expect(merged.key).toBe("abc");
    expect(isSelectionSentinel(merged)).toBe(true);
    expect(selectionSentinelVenueId(merged)).toBe("venue-xyz");
  });

  it("handles a null/non-object base", () => {
    expect(withSelectionSentinel(null, "v1")).toEqual({
      pubmaxSelection: PUBMAX_SELECTION_SENTINEL,
      venueId: "v1",
    });
    expect(isSelectionSentinel(withSelectionSentinel(undefined, "v1"))).toBe(true);
  });
});

describe("searchHasSelection", () => {
  it("is true only when sel is present", () => {
    expect(searchHasSelection("?sel=venue-abc")).toBe(true);
    expect(searchHasSelection("?sel=venue-abc&accept=1&src=near")).toBe(true);
    expect(searchHasSelection("?pubs=a,b&mode=build")).toBe(false);
    expect(searchHasSelection("")).toBe(false);
  });
});

describe("cleanMapUrl", () => {
  it("strips sel/accept/src but preserves owned passthrough params", () => {
    expect(cleanMapUrl("/map", "?sel=v1&accept=1&src=near&pubs=a,b&plan=1")).toBe(
      "/map?pubs=a%2Cb&plan=1",
    );
  });

  it("returns a bare pathname when only selection params were present", () => {
    expect(cleanMapUrl("/map", "?sel=v1&accept=1&src=near")).toBe("/map");
    expect(cleanMapUrl("/map", "")).toBe("/map");
  });

  it("keeps a hash", () => {
    expect(cleanMapUrl("/map", "?sel=v1", "#here")).toBe("/map#here");
  });
});

describe("browseSelectionUrl", () => {
  it("sets sel and drops acceptance markers while keeping owned params", () => {
    // Switching to a browse pin from an accepted arrival must not carry accept/src.
    expect(browseSelectionUrl("/map", "?sel=v1&accept=1&src=near&food=1", "v2")).toBe(
      "/map?sel=v2&food=1",
    );
  });

  it("adds sel to a clean Map preserving other params", () => {
    expect(browseSelectionUrl("/map", "?food=1", "v9")).toBe("/map?food=1&sel=v9");
  });
});

describe("selectionTransition", () => {
  it("no-ops when the selection is unchanged", () => {
    expect(selectionTransition({ prev: "v1", next: "v1", currentEntryOwnsSentinel: true })).toEqual({
      kind: "none",
    });
    expect(selectionTransition({ prev: "", next: "", currentEntryOwnsSentinel: false })).toEqual({
      kind: "none",
    });
  });

  it("pushes on the first selection from a clean Map", () => {
    expect(selectionTransition({ prev: "", next: "v1", currentEntryOwnsSentinel: false })).toEqual({
      kind: "push",
      venueId: "v1",
    });
  });

  it("replaces when switching Venue while a sentinel is active", () => {
    expect(selectionTransition({ prev: "v1", next: "v2", currentEntryOwnsSentinel: true })).toEqual({
      kind: "replace",
      venueId: "v2",
    });
  });

  it("pops with Back on close when the current entry owns the sentinel", () => {
    expect(selectionTransition({ prev: "v1", next: "", currentEntryOwnsSentinel: true })).toEqual({
      kind: "back",
    });
  });

  it("strips the URL on close when no sentinel is owned", () => {
    expect(selectionTransition({ prev: "v1", next: "", currentEntryOwnsSentinel: false })).toEqual({
      kind: "strip",
    });
  });
});
