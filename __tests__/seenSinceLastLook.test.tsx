// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SEEN_MEMORY_LIMIT,
  __resetSeenBaselineCache,
  mergeSeenIds,
  newGroups,
  parseSeenIds,
  readSeenBaseline,
  recordSeen,
  useNewSinceLastLook,
} from "@/lib/seenSinceLastLook";

/**
 * "New since you last looked" (lib/seenSinceLastLook.ts): a row is new only
 * when this device was not shown its id on the surface before, a first visit
 * marks nothing, the baseline holds for the session, and memory is bounded.
 */

/** A new browser session: sessionStorage and the page cache go, localStorage stays. */
function newSession() {
  window.sessionStorage.clear();
  __resetSeenBaselineCache();
}

beforeEach(() => {
  window.localStorage.clear();
  newSession();
});

describe("newGroups", () => {
  it("marks nothing without a baseline", () => {
    expect(newGroups([["a"], ["b"]], null)).toEqual([false, false]);
  });

  it("calls a family new only when none of its members was seen", () => {
    const seen = new Set(["deal-at-pub-1", "quiz-thursday"]);
    expect(
      newGroups(
        [
          ["deal-at-pub-2", "deal-at-pub-1"], // the nearest card changed; the offer is not new
          ["quiz-thursday"],
          ["gig-friday"],
          [],
        ],
        seen,
      ),
    ).toEqual([false, false, true, false]);
  });
});

describe("mergeSeenIds and parseSeenIds", () => {
  it("keeps this visit first, dedupes and caps", () => {
    expect(mergeSeenIds(["b", "c"], ["a", "b"], 10)).toEqual(["a", "b", "c"]);
    const many = Array.from({ length: SEEN_MEMORY_LIMIT + 50 }, (_, i) => `id-${i}`);
    expect(mergeSeenIds([], many)).toHaveLength(SEEN_MEMORY_LIMIT);
  });

  it("reads junk as no memory", () => {
    expect(parseSeenIds(null)).toBeNull();
    expect(parseSeenIds("{oops")).toBeNull();
    expect(parseSeenIds('{"a":1}')).toBeNull();
    expect(parseSeenIds('["a", 3, ""]')).toEqual(["a"]);
  });
});

describe("the baseline", () => {
  it("is empty on a first visit and holds for the whole session", () => {
    expect(readSeenBaseline("tonight")).toBeNull();
    recordSeen("tonight", ["a", "b"]);
    // Same session, even after a reload (page cache gone, sessionStorage kept).
    __resetSeenBaselineCache();
    expect(readSeenBaseline("tonight")).toBeNull();
    // Next session compares against what this one was shown.
    newSession();
    expect([...(readSeenBaseline("tonight") ?? [])]).toEqual(["a", "b"]);
    recordSeen("tonight", ["c"]);
    __resetSeenBaselineCache();
    expect([...(readSeenBaseline("tonight") ?? [])]).toEqual(["a", "b"]);
  });

  it("keeps each surface's memory apart", () => {
    recordSeen("drops", ["drop-1"]);
    newSession();
    expect(readSeenBaseline("tonight")).toBeNull();
    expect([...(readSeenBaseline("drops") ?? [])]).toEqual(["drop-1"]);
  });
});

describe("useNewSinceLastLook", () => {
  let container: HTMLDivElement;
  let root: Root;
  let flags: boolean[] = [];

  function Probe({ groups, shown }: { groups: string[][]; shown: boolean }) {
    flags = useNewSinceLastLook("tonight", groups, shown);
    return null;
  }

  async function render(groups: string[][], shown = true) {
    await act(async () => {
      root.render(createElement(Probe, { groups, shown }));
    });
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("marks nothing on a first visit, then marks only what arrived since", async () => {
    await render([["quiz-thursday"], ["deal-1", "deal-2"]]);
    expect(flags).toEqual([false, false]);

    act(() => root.unmount());
    newSession();
    root = createRoot(container);
    await render([["gig-friday"], ["quiz-thursday"], ["deal-2", "deal-1"]]);
    expect(flags).toEqual([true, false, false]);
  });

  it("does not remember a list that has not been shown", async () => {
    await render([["quiz-thursday"]], false);
    expect(window.localStorage.getItem("pubmax:seen:tonight:v1")).toBeNull();
  });
});
