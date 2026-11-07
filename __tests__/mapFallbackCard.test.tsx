// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import MapFallbackCard from "@/components/map/MapFallbackCard";
import type { Venue } from "@/lib/venues";

it("offers the directory and retry before venue rows and preserves all fallback actions", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const retry = vi.fn();
  const select = vi.fn();
  const venues = Array.from({ length: 6 }, (_, index) => ({
    id: `pub-${index}`, name: `Pub ${index}`, primaryBorough: "Camden", cheapestPrice: 5,
  } as Venue));
  try {
    act(() => root.render(createElement(MapFallbackCard, {
      heading: "Map unavailable",
      message: "The map could not load its tiles.",
      detail: "Both styles failed",
      venues,
      onSelectVenue: select,
      onRetry: retry,
    })));
    const browse = host.querySelector<HTMLAnchorElement>(".mapFallbackBrowse")!;
    const retryButton = host.querySelector<HTMLButtonElement>(".mapFallbackRetry")!;
    const firstVenue = host.querySelector<HTMLButtonElement>(".mapFallbackVenue")!;
    expect(browse.getAttribute("href")).toBe("/pubs");
    expect(browse.compareDocumentPosition(firstVenue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(retryButton.compareDocumentPosition(firstVenue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => retryButton.click());
    expect(retry).toHaveBeenCalledOnce();
    act(() => firstVenue.click());
    expect(select).toHaveBeenCalledWith("pub-0");
    const disclosure = host.querySelector<HTMLButtonElement>(".mapFallbackDisclosureToggle")!;
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    act(() => disclosure.click());
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".mapFallbackDetail")?.textContent).toBe("Both styles failed");
    act(() => disclosure.click());
    expect(host.querySelector(".mapFallbackDetail")).toBeNull();
    act(() => root.render(createElement(MapFallbackCard, {
      heading: "Map unavailable",
      message: "WebGL is unavailable.",
      venues,
      onSelectVenue: select,
      onRetry: null,
    })));
    expect(host.querySelector(".mapFallbackRetry")).toBeNull();
    expect(host.querySelector(".mapFallbackBrowse")?.getAttribute("href")).toBe("/pubs");
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
