// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/analytics", () => analytics);

import { NO_RESULTS_MESSAGE, useMapSearchMiss } from "@/components/map/useMapSearchMiss";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MissInput = Parameters<typeof useMapSearchMiss>[0];

function Probe(props: MissInput) {
  return createElement("output", null, JSON.stringify(useMapSearchMiss(props)));
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  analytics.trackEvent.mockClear();
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const miss: MissInput = {
  showPanel: true,
  trimmed: "Ancoats",
  deferredTrimmed: "Ancoats",
  querySettled: true,
  searchIndexLoading: false,
  hasResults: false,
};

function render(input: MissInput) {
  act(() => root.render(createElement(Probe, input)));
  return JSON.parse(host.textContent!) as ReturnType<typeof useMapSearchMiss>;
}

function settle() {
  act(() => vi.runAllTimers());
  return JSON.parse(host.textContent!) as ReturnType<typeof useMapSearchMiss>;
}

describe("useMapSearchMiss", () => {
  it("shows the empty line at once and speaks and counts the miss once it holds", () => {
    expect(render(miss)).toEqual({ showEmptyLine: true, liveAnnouncement: "" });
    expect(settle()).toEqual({ showEmptyLine: true, liveAnnouncement: NO_RESULTS_MESSAGE });
    expect(analytics.trackEvent).toHaveBeenCalledExactlyOnceWith("map_search_no_results");
  });

  it("counts a repeated miss once, and again after results came between", () => {
    render(miss);
    settle();
    render({ ...miss, deferredTrimmed: "ANCOATS" });
    settle();
    expect(analytics.trackEvent).toHaveBeenCalledTimes(1);

    expect(render({ ...miss, hasResults: true })).toEqual({ showEmptyLine: false, liveAnnouncement: "" });
    render(miss);
    settle();
    expect(analytics.trackEvent).toHaveBeenCalledTimes(2);
  });

  it.each([
    { searchIndexLoading: true },
    { querySettled: false },
    { showPanel: false },
    { trimmed: "", deferredTrimmed: "" },
  ])("says nothing while the search is not a settled miss: %j", (state) => {
    expect(render({ ...miss, ...state })).toEqual({ showEmptyLine: false, liveAnnouncement: "" });
    settle();
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });
});
