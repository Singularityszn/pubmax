// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GardenTonightCard from "@/components/discovery/GardenTonightCard";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

// The card is the one consumer of lib/gardenWeather. It must paint neither a
// "dry" sky nor a garden suggestion from a status whose rain chance or
// daylight is unknown, and it must not go looking for pubs to suggest.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

const OPEN_GARDEN_PUB = {
  id: "garden-pub-1",
  name: "The Test Garden",
  area: "Soho",
  location: { lat: 51.5136, lng: -0.1365 },
  types: ["pub"],
  openNow: true,
};

function serveStatus(weather: Record<string, unknown>) {
  fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const body = String(input).includes("/api/citymcp/status")
      ? { weather }
      : { places: [OPEN_GARDEN_PUB] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
}

function requestedUrls(): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

async function renderCard() {
  await act(async () => {
    root.render(<GardenTonightCard />);
  });
  // Two sequential reads and a deferred state write: let each settle.
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  clearSurfaceCache();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clearSurfaceCache();
  vi.unstubAllGlobals();
});

describe("GardenTonightCard suggests the garden only on known rain and daylight", () => {
  it("renders a known rain chance as a chance, never as dry", async () => {
    serveStatus({ feelsLikeC: 22, precipProbabilityPct: 10, isDay: true });
    await renderCard();
    expect(host.querySelector(".gardenTonightSection")).not.toBeNull();
    expect(host.querySelector("#gardenTonight-title")?.textContent).toBe(
      "Feels like 22°C, 10% chance of rain. Beer-garden weather.",
    );
    expect(host.textContent).toContain("The Test Garden");
    expect(host.textContent).not.toMatch(/\bdry\b/i);
  });

  it.each<[string, Record<string, unknown>]>([
    ["the rain chance is missing", { feelsLikeC: 22, isDay: true }],
    ["the rain chance is null", { feelsLikeC: 22, precipProbabilityPct: null, isDay: true }],
    ["daylight is missing", { feelsLikeC: 22, precipProbabilityPct: 10 }],
    ["daylight is null", { feelsLikeC: 22, precipProbabilityPct: 10, isDay: null }],
  ])("renders nothing and asks for no pubs when %s", async (_label, weather) => {
    serveStatus(weather);
    await renderCard();
    expect(requestedUrls().some((url) => url.includes("/api/citymcp/status"))).toBe(true);
    expect(host.querySelector(".gardenTonightSection")).toBeNull();
    expect(host.textContent).not.toMatch(/\bdry\b/i);
    expect(host.textContent).not.toMatch(/garden weather/i);
    expect(requestedUrls().some((url) => url.includes("/api/citymcp/places"))).toBe(false);
  });
});
