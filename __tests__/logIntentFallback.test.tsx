// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogIntentFallback } from "@/components/map/pubmap/LogIntentFallback";

describe("price contribution pub picker", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for location only when the reader chooses Near me", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const locate = vi.fn();
    let success: PositionCallback | undefined;
    const geolocate = vi.fn((callback: PositionCallback) => { success = callback; });
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: geolocate } });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    try {
      await act(async () => root.render(createElement(LogIntentFallback, {
        candidates: [], origin: null, filteredPubVenueCount: 1,
        onPickVenue: vi.fn(), onPrefetchVenue: vi.fn(), onFocusSearch: vi.fn(),
        onResetFilters: vi.fn(), onLocation: locate,
      })));
      expect(geolocate).not.toHaveBeenCalled();
      expect(locate).not.toHaveBeenCalled();
      const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Near me");
      expect(button).toBeDefined();
      await act(async () => button!.click());
      expect(geolocate).toHaveBeenCalledOnce();
      expect(button!.disabled).toBe(true);
      expect(locate).not.toHaveBeenCalled();
      await act(async () => success!({ coords: { latitude: 51.55, longitude: -0.1 } } as GeolocationPosition));
      expect(locate).toHaveBeenCalledExactlyOnceWith({ lat: 51.55, lng: -0.1 });
      expect(button!.disabled).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it.each(["denied", "unsupported"])("keeps search available when location is %s", async (failure) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const locate = vi.fn();
    const search = vi.fn();
    vi.stubGlobal("navigator", failure === "unsupported" ? {} : {
      geolocation: { getCurrentPosition: (_success: PositionCallback, reject: PositionErrorCallback) => reject({ code: 1 } as GeolocationPositionError) },
    });
    try {
      await act(async () => root.render(createElement(LogIntentFallback, {
        candidates: [], origin: null, filteredPubVenueCount: 1,
        onPickVenue: vi.fn(), onPrefetchVenue: vi.fn(), onFocusSearch: search,
        onResetFilters: vi.fn(), onLocation: locate,
      })));
      await act(async () => [...host.querySelectorAll("button")].find((item) => item.textContent === "Near me")!.click());
      expect(host.textContent).toContain("Search for your pub instead");
      expect(locate).not.toHaveBeenCalled();
      await act(async () => [...host.querySelectorAll("button")].find((item) => item.textContent === "Search pubs")!.click());
      expect(search).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
