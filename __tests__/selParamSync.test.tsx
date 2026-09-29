// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { useSelParamSync } from "@/components/map/pubmap/useSelParamSync";
import { selectionSentinel } from "@/lib/mapSelectionHistory";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("client selection URL sync", () => {
  it.each([
    { name: "leaves owned history restoration to the map", state: selectionSentinel("venue-next"), calls: 0 },
    { name: "selects a venue from client navigation", state: null, calls: 1 },
    { name: "selects a new venue when the sentinel names another", state: selectionSentinel("venue-previous"), calls: 1 },
  ])("$name", async ({ state, calls }) => {
    const previousState = window.history.state;
    window.history.replaceState(state, "");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const selectVenue = vi.fn();
    function Sync() {
      useSelParamSync({ selParam: "venue-next", selectedVenueId: "", selectVenue });
      return null;
    }
    try {
      await act(async () => root.render(createElement(Sync)));
      expect(selectVenue).toHaveBeenCalledTimes(calls);
      if (calls) expect(selectVenue).toHaveBeenCalledWith("venue-next");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      window.history.replaceState(previousState, "");
    }
  });
});
