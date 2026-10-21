// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import MapSearchEmptyState from "@/components/map/MapSearchEmptyState";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([1, 3])("offers to show %i known matches outside the view", (matchCount) => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const onShowMatches = vi.fn();
  const onClear = vi.fn();
  try {
    act(() => root.render(createElement(MapSearchEmptyState, {
      query: "Churchill Arms", matchCount, onShowMatches, onClear,
    })));
    expect(host.textContent).toContain("No matching pubs in this view");
    const show = [...host.querySelectorAll("button")].find((button) => button.textContent ===
      (matchCount === 1 ? "Show the matching pub" : "Show matching pubs"));
    expect(show).toBeDefined();
    act(() => show!.click());
    expect(onShowMatches).toHaveBeenCalledOnce();
    expect(onClear).not.toHaveBeenCalled();
    act(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "Clear search")!.click());
    expect(onClear).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
  }
});
