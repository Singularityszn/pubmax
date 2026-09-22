// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  EMPTY_MAP_SURFACE_STATE,
  useMapSurfaceNavigation,
  type MapSurfaceState,
} from "@/components/map/pubmap/useMapSurfaceNavigation";
import { readMapSurfaceHistory } from "@/lib/mapSurfaceHistory";
import type { SurfaceEntry } from "@/lib/surfaceStack";

type Navigation = ReturnType<typeof useMapSurfaceNavigation>;

const plannerState: MapSurfaceState = {
  ...EMPTY_MAP_SURFACE_STATE,
};
const rejectedVenueState: MapSurfaceState = {
  ...EMPTY_MAP_SURFACE_STATE,
  venueId: "venue-missing",
};

describe("rejected Map selections", () => {
  let host: HTMLDivElement;
  let root: Root;
  let navigation: Navigation | null;
  let onRestore: Mock<(entry: SurfaceEntry<MapSurfaceState> | null) => void>;

  function Harness() {
    navigation = useMapSurfaceNavigation({
      arrivalSearch: "",
      surfaceId: "none",
      surfaceTitle: "Map",
      surfaceState: EMPTY_MAP_SURFACE_STATE,
      selectionHint: "",
      onRestore,
      onHome: vi.fn(),
    });
    return null;
  }

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState({}, "", "/map");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    navigation = null;
    onRestore = vi.fn();
    await act(async () => root.render(createElement(Harness)));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("retires a rejected arrival even while browser traversal is delayed", () => {
    act(() => {
      navigation!.open({
        id: "venue",
        title: "Missing pub",
        state: rejectedVenueState,
      });
    });
    expect(new URL(window.location.href).searchParams.get("sel")).toBe("venue-missing");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);

    act(() => navigation!.rejectSelection("venue-missing"));

    expect(back).toHaveBeenCalledOnce();
    expect(new URL(window.location.href).searchParams.has("sel")).toBe(false);
    expect(readMapSurfaceHistory<MapSurfaceState>(window.history.state)).toEqual([]);
    expect(navigation!.holdsSurface("venue")).toBe(false);
    expect(onRestore).toHaveBeenLastCalledWith(null);
  });

  it("preserves the parent in the entry Forward could revisit", () => {
    act(() => {
      navigation!.open({ id: "planner", title: "Plan an outing", state: plannerState });
    });
    act(() => {
      navigation!.open({
        id: "venue",
        title: "Missing pub",
        state: rejectedVenueState,
      });
    });
    vi.spyOn(window.history, "back").mockImplementation(() => undefined);

    act(() => navigation!.rejectSelection("venue-missing"));

    expect(readMapSurfaceHistory<MapSurfaceState>(window.history.state)).toEqual([
      { id: "planner", title: "Plan an outing", state: plannerState },
    ]);
    expect(navigation!.holdsSurface("planner")).toBe(true);
    expect(navigation!.holdsSurface("venue")).toBe(false);
    expect(onRestore).toHaveBeenLastCalledWith({
      id: "planner",
      title: "Plan an outing",
      state: plannerState,
    });
  });
});
