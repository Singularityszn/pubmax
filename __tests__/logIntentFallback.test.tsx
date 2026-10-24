// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogIntentFallback } from "@/components/map/pubmap/LogIntentFallback";
import { useLogPickerLocation } from "@/components/map/pubmap/useLogPickerLocation";
import { buildLogNearbyCandidates, resolveLogNearbyOrigin, LOG_NEARBY_MAX_KM, type LogNearbyOrigin } from "@/lib/mapLogIntent";

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


describe("picker location lifetime", () => {
  afterEach(() => vi.unstubAllGlobals());

  const a = { lat: 51.55, lng: -0.1 };
  const b = { lat: 51.4, lng: -0.1 };
  const mapCenter: [number, number] = [-0.1, 51.5];
  const venues = [
    { id: "a", name: "Pub at A", latitude: a.lat, longitude: a.lng },
    { id: "b", name: "Pub at B", latitude: b.lat, longitude: b.lng },
  ];

  it.each(["dismiss", "map update"] as const)("retires the picker fix after %s and uses the later map fix", async (boundary) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const callbacks: PositionCallback[] = [];
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (callback: PositionCallback) => callbacks.push(callback) } });
    let pickerLocation: LogNearbyOrigin | null = null;
    const onDismiss = vi.fn();
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    function Picker({ active, userLocation }: { active: boolean; userLocation: LogNearbyOrigin | null }) {
      const picker = useLogPickerLocation(active, userLocation);
      pickerLocation = picker.location;
      const resolved = resolveLogNearbyOrigin({ pickerLocation: picker.location, userLocation, mapCenter });
      const candidates = buildLogNearbyCandidates(
        userLocation === b ? [venues[1]!] : venues,
        undefined, resolved?.origin, LOG_NEARBY_MAX_KM,
      );
      return active ? createElement(LogIntentFallback, {
        candidates, origin: resolved?.source ?? null, filteredPubVenueCount: candidates.length,
        onPickVenue: vi.fn(), onPrefetchVenue: vi.fn(), onFocusSearch: vi.fn(),
        onResetFilters: vi.fn(), onLocation: picker.setLocation, onDismiss,
      }) : null;
    }
    const show = async (active: boolean, userLocation: LogNearbyOrigin | null) => {
      await act(async () => root.render(createElement(Picker, { active, userLocation })));
    };
    const locate = async () => {
      await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Near me")!.click());
    };
    const resolve = async (index: number, point: LogNearbyOrigin) => {
      await act(async () => callbacks[index]!({ coords: { latitude: point.lat, longitude: point.lng } } as GeolocationPosition));
    };
    try {
      await show(true, null);
      await locate();
      await resolve(0, a);
      expect(pickerLocation).toEqual(a);
      expect(host.textContent).toContain("Pub at A");
      expect(host.textContent).not.toContain("Pub at B");
      expect(host.textContent).toContain("0 m");

      await locate();
      await show(true, null);
      expect(pickerLocation).toEqual(a);
      await resolve(1, a);
      expect(pickerLocation).toEqual(a);

      await locate();
      if (boundary === "dismiss") {
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close the pub picker"]')!.click());
        expect(onDismiss).toHaveBeenCalledOnce();
        await show(false, null);
        expect(pickerLocation).toBeNull();
        await show(false, b);
      } else {
        await show(true, b);
      }
      expect(pickerLocation).toBeNull();
      await show(true, b);
      await resolve(2, a);
      expect(pickerLocation).toBeNull();
      expect(host.textContent).toContain("Pub at B");
      expect(host.textContent).not.toContain("Pub at A");
      expect(host.textContent).toContain("0 m");

      await locate();
      await resolve(3, b);
      expect(pickerLocation).toEqual(b);
      expect(storageWrite).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      storageWrite.mockRestore();
      host.remove();
    }
  });
});
