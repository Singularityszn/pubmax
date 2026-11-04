// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const { loadVenues } = vi.hoisted(() => ({ loadVenues: vi.fn() }));
vi.mock("@/lib/venuesSlim", () => ({ loadSlimVenuesForCityResult: loadVenues }));
import PubTarot from "@/components/wild/PubTarot";
import { writeBudgetChoice } from "@/lib/onboardingFlow";

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); window.localStorage.clear(); });

const venues = ["a", "b", "c"].map((id) => ({
  id, name: `Pub ${id}`, borough: "Westminster", lat: 51.5129, lng: -0.13,
  cheapestPrice: 5, priceSource: "Pint Prices", priceObservedAt: "2026-10-02",
}));
const heritage = { listings: Object.fromEntries(venues.map(({ id }, index) => [id, {
  listEntry: 1235282 + index, fact: "Grade II listed public house.",
  url: `https://historicengland.org.uk/listing/the-list/list-entry/${1235282 + index}`,
}])) };

function mount() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root!.render(<PubTarot cityId="london" random={() => 0} />));
  return host;
}

it("reads heritage only after a draw and renders three linked facts without price claims", async () => {
  const locate = vi.fn((_: PositionCallback, denied: PositionErrorCallback) => denied({ code: 1 } as GeolocationPositionError));
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: locate } });
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => heritage }); vi.stubGlobal("fetch", fetcher);
  loadVenues.mockResolvedValue({ status: "ready", rows: venues });
  const host = mount();
  expect(fetcher).not.toHaveBeenCalled(); expect(locate).not.toHaveBeenCalled(); expect(loadVenues).not.toHaveBeenCalled();
  const button = host.querySelector("button")!; button.focus();
  await act(async () => { button.click(); });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]?.[0]).toBe("/data/heritage_listings.json");
  expect(loadVenues).toHaveBeenCalledWith("london");
  expect(Array.from(host.querySelectorAll("h3")).map((node) => node.textContent)).toEqual(["Where you were", "Where you are", "Where you are going"]);
  expect(host.querySelectorAll('a[href^="https://historicengland.org.uk/"]')).toHaveLength(3);
  expect(host.querySelectorAll('a[href^="/map"]')).toHaveLength(3);
  expect(host.textContent).toContain("No location, so this draw is from central London.");
  expect(host.textContent).not.toContain("£5");
  expect(document.activeElement).toBe(button);
});

it("uses the saved cap and leaves fewer than three cards empty", async () => {
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => heritage }));
  loadVenues.mockResolvedValue({ status: "ready", rows: venues.map((venue, index) => ({ ...venue, cheapestPrice: index === 2 ? 7 : 5 })) });
  writeBudgetChoice("six");
  const host = mount();
  await act(async () => host.querySelector("button")!.click());
  expect(host.querySelectorAll(".pubTarotCards > li")).toHaveLength(0);
  expect(host.textContent).toContain("Fewer than three pubs match this draw.");
  expect(host.textContent).toContain("Your saved pint budget limits this draw.");
  expect(host.querySelector("button")?.textContent).toBe("Draw again");
});

it("keeps the accepted position local and does not save the draw", async () => {
  const locate = vi.fn((found: PositionCallback) => found({ coords: { latitude: 51.5128, longitude: -0.1301 } } as GeolocationPosition));
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: locate } });
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => heritage }); vi.stubGlobal("fetch", fetcher);
  loadVenues.mockResolvedValue({ status: "ready", rows: venues });
  const before = { ...window.localStorage };
  const host = mount(); await act(async () => host.querySelector("button")!.click());
  expect(fetcher.mock.calls[0]?.[0]).toBe("/data/heritage_listings.json");
  expect(Object.keys(fetcher.mock.calls[0]?.[1] ?? {})).toEqual(["signal"]);
  expect(host.querySelectorAll(".pubTarotCards > li")).toHaveLength(3);
  expect(host.textContent).not.toContain("No location");
  expect({ ...window.localStorage }).toEqual(before);
});

it.each(["heritage", "pubs", "malformed"])("reports an unreadable %s read separately from a small pool", async (failure) => {
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: failure !== "heritage", json: async () => failure === "malformed" ? {} : heritage }));
  loadVenues.mockResolvedValue(failure === "pubs" ? { status: "unavailable" } : { status: "ready", rows: venues });
  const host = mount(); await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("The pub list or heritage links could not load.");
  expect(host.textContent).not.toContain("Fewer than three");
  expect(host.querySelector("button")?.disabled).toBe(false);
});

it("does not start a source read when location returns after the preview unmounts", async () => {
  let found!: PositionCallback;
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (callback: PositionCallback) => { found = callback; } } });
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const host = mount(); act(() => host.querySelector("button")!.click());
  act(() => root!.unmount()); root = null;
  await act(async () => found({ coords: { latitude: 51.5129, longitude: -0.13 } } as GeolocationPosition));
  expect(fetcher).not.toHaveBeenCalled(); expect(loadVenues).not.toHaveBeenCalled();
});

it("aborts an owned asset read when the preview unmounts", async () => {
  vi.stubGlobal("navigator", {});
  let signal!: AbortSignal;
  vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => {
    signal = options.signal!;
    return new Promise(() => {});
  }));
  loadVenues.mockResolvedValue({ status: "ready", rows: venues });
  const host = mount(); act(() => host.querySelector("button")!.click());
  act(() => root!.unmount()); root = null;
  expect(signal.aborted).toBe(true);
});

it("lets the user retry when a pub read hangs after heritage arrives", async () => {
  vi.useFakeTimers(); vi.stubGlobal("navigator", {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => heritage }));
  loadVenues.mockReturnValue(new Promise(() => {}));
  const host = mount(); await act(async () => host.querySelector("button")!.click());
  await act(async () => { vi.advanceTimersByTime(10_000); });
  expect(host.textContent).toContain("The pub list or heritage links could not load.");
  expect(host.querySelector("button")?.disabled).toBe(false);
});
