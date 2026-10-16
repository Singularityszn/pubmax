// @vitest-environment jsdom

// DEFECT (review of the UX sprint fix, 16 Oct 2026): the phone pub sheet's one
// plan button read the crawl alone, so removing the LAST stop emptied the
// crawl while the sheet was still open and the same button node turned from
// the crawl's toggle into a navigation to /plan. A mistap, or an intended
// re-pick, left the map and abandoned the build session. The phone has no
// other way back into build from the peek.
//
// The door the sheet opened with is the door it keeps. Driven here through the
// real hook in a real React render; the rendered phone sheet is driven in a
// browser by e2e/map-plan-stop-pill.spec.ts.

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePeekPlanDoorBuildsCrawl } from "@/components/map/pubmap/usePeekPlanDoor";

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host.remove();
});

function Door({ builtStopCount, selectedVenueId }: {
  builtStopCount: number;
  selectedVenueId: string;
}) {
  const buildsCrawl = usePeekPlanDoorBuildsCrawl({ builtStopCount, selectedVenueId });
  return createElement("span", null, buildsCrawl ? "Plan stop" : "Make it Stop 1");
}

function show(builtStopCount: number, selectedVenueId: string, strict = false) {
  const door = createElement(Door, { builtStopCount, selectedVenueId });
  act(() => root?.render(strict ? createElement(StrictMode, null, door) : door));
  return host.textContent;
}

describe("the phone peek's one plan door", () => {
  it("hands the pub to Plan when no crawl is being built", () => {
    expect(show(0, "venue-a")).toBe("Make it Stop 1");
  });

  it("adds to the crawl while one is being built", () => {
    expect(show(1, "venue-a")).toBe("Plan stop");
  });

  it("keeps the crawl's door when the reader removes the last stop", () => {
    expect(show(1, "venue-a")).toBe("Plan stop");
    expect(show(0, "venue-a")).toBe("Plan stop");
  });

  it("takes the crawl's door the moment a crawl starts under the open sheet", () => {
    expect(show(0, "venue-a")).toBe("Make it Stop 1");
    expect(show(1, "venue-a")).toBe("Plan stop");
    expect(show(0, "venue-a")).toBe("Plan stop");
  });

  it("reads the night again for the next pub's sheet", () => {
    expect(show(1, "venue-a")).toBe("Plan stop");
    expect(show(0, "venue-a")).toBe("Plan stop");
    expect(show(0, "venue-b")).toBe("Make it Stop 1");
  });

  it("drops the latch when the sheet closes, so reopening the same pub reads the night", () => {
    expect(show(1, "venue-a")).toBe("Plan stop");
    expect(show(0, "venue-a")).toBe("Plan stop");
    show(0, "");
    expect(show(0, "venue-a")).toBe("Make it Stop 1");
  });

  it("holds under StrictMode's double render", () => {
    expect(show(1, "venue-a", true)).toBe("Plan stop");
    expect(show(0, "venue-a", true)).toBe("Plan stop");
  });
});
