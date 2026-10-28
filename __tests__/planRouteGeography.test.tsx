// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import shoreditchCell from "@/public/data/venues_slim.cell.51.525_-0.100.json";
import { haversineKm } from "@/lib/haversine";
import { nightAreaForMapQuery } from "@/lib/nightAreas";

vi.mock("next/dynamic", () => ({
  default: () => () => createElement("div", { "data-testid": "route-canvas" }),
}));

import PlanRouteMiniMap from "@/components/plan/PlanRouteMiniMap";

// These committed venue records are near Old Street, within the existing
// Shoreditch search radius. They are not the unknown original reported stops.
const masque = shoreditchCell.rows.find((venue) => venue.id === "venue-10ilrk3")!;
const eagle = shoreditchCell.rows.find((venue) => venue.id === "venue-w001wg")!;
const sports = shoreditchCell.rows.find((venue) => venue.id === "venue-8ydt68")!;
const stops = [masque, eagle].map((venue, position) => ({
  venueId: venue.id,
  venueName: venue.name,
  position,
}));
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ getExtension: () => null } as unknown as WebGL2RenderingContext);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const venue = [masque, eagle, sports].find((row) => String(input).endsWith(`/api/venue/${row.id}`));
    if (!venue) return Response.json({}, { status: 503 });
    return Response.json({ venue: {
      latitude: venue.lat,
      longitude: venue.lng,
      locality: venue.locality,
      primaryBorough: venue.borough,
    } });
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

function accessibleName(): string {
  const group = host.querySelector('[role="group"]')!;
  return group.getAttribute("aria-labelledby")!.split(" ")
    .map((id) => document.getElementById(id)!.textContent).join(" ");
}

it("names every recorded area for an Old Street route within Shoreditch search distance", async () => {
  const area = nightAreaForMapQuery("london", "Shoreditch")!;
  for (const venue of [masque, eagle]) {
    expect(haversineKm([venue.lng, venue.lat], [area.centre.lng, area.centre.lat])).toBeLessThan(area.radiusKm);
  }
  await act(async () => root.render(createElement(PlanRouteMiniMap, { stops })));
  expect(accessibleName()).toMatch(/^Route map: 2 stops across Hackney and Islington /);
  expect(accessibleName()).toContain("The Masque Haunt, The Eagle.");
  const walkRequest = vi.mocked(fetch).mock.calls.find(([url]) => String(url).startsWith("/api/walk-route?"))!;
  expect(new URL(String(walkRequest[0]), "https://example.test").searchParams.get("stops"))
    .toBe("-0.090642,51.5252;-0.0916478,51.5286");
});


it("retains mixed geography and the mounted canvas when the same venues change order", async () => {
  await act(async () => root.render(createElement(PlanRouteMiniMap, { stops })));
  const canvas = host.querySelector('[data-testid="route-canvas"]');
  const calls = vi.mocked(fetch).mock.calls.length;
  await act(async () => root.render(createElement(PlanRouteMiniMap, {
    stops: [...stops].reverse().map((stop, position) => ({ ...stop, position })),
  })));
  expect(accessibleName()).toMatch(/^Route map: 2 stops across Hackney and Islington /);
  expect(accessibleName()).toContain("The Eagle, The Masque Haunt.");
  expect(host.querySelector('[data-testid="route-canvas"]')).toBe(canvas);
  const nextVenueCalls = vi.mocked(fetch).mock.calls.slice(calls)
    .filter(([url]) => String(url).startsWith("/api/venue/"));
  expect(nextVenueCalls).toHaveLength(0);
});

it("uses a common recorded area when every stop supports it", async () => {
  const sameArea = [masque, sports].map((venue, position) => ({
    venueId: venue.id, venueName: venue.name, position,
  }));
  await act(async () => root.render(createElement(PlanRouteMiniMap, { stops: sameArea })));
  expect(accessibleName()).toMatch(/^Route map: 2 stops in Islington /);
});

it.each([{}, { locality: "", primaryBorough: "  " }, { locality: "Greater London" }])(
  "keeps the route neutral when a stop has no specific recorded geography: %j",
  async (missingGeography) => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith(masque.id)) {
        return Response.json({ venue: {
          latitude: masque.lat, longitude: masque.lng, ...missingGeography,
        } });
      }
      if (String(input).endsWith(eagle.id)) {
        return Response.json({ venue: {
          latitude: eagle.lat, longitude: eagle.lng, primaryBorough: eagle.borough,
        } });
      }
      return Response.json({}, { status: 503 });
    });
    await act(async () => root.render(createElement(PlanRouteMiniMap, { stops })));
    expect(accessibleName()).toMatch(/^Route map: 2 stops (?:Walking|Approximate)/);
    expect(accessibleName()).not.toContain("Hackney");
    expect(accessibleName()).not.toContain("London");
  },
);

it("does not publish a late area's label after the stops change", async () => {
  const pending = new Map<string, (response: Response) => void>();
  const currentFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((input, init) => {
    if (String(input).includes("/api/venue/")) {
      return new Promise<Response>((resolve) => pending.set(String(input), resolve));
    }
    return currentFetch(input, init);
  });
  await act(async () => root.render(createElement(PlanRouteMiniMap, { stops })));
  const oldMasque = pending.get(`/api/venue/${masque.id}`)!;
  const oldEagle = pending.get(`/api/venue/${eagle.id}`)!;
  const nextStops = [masque, sports].map((venue, position) => ({
    venueId: venue.id, venueName: venue.name, position,
  }));
  await act(async () => root.render(createElement(PlanRouteMiniMap, { stops: nextStops })));
  await act(async () => {
    for (const venue of [masque, sports]) {
      pending.get(`/api/venue/${venue.id}`)!(Response.json({ venue: {
        latitude: venue.lat, longitude: venue.lng, primaryBorough: venue.borough,
      } }));
    }
  });
  expect(accessibleName()).toMatch(/^Route map: 2 stops in Islington /);
  await act(async () => {
    oldMasque(Response.json({ venue: {
      latitude: masque.lat, longitude: masque.lng, primaryBorough: masque.borough,
    } }));
    oldEagle(Response.json({ venue: {
      latitude: eagle.lat, longitude: eagle.lng, primaryBorough: eagle.borough,
    } }));
  });
  expect(accessibleName()).toMatch(/^Route map: 2 stops in Islington /);
  expect(accessibleName()).not.toContain("The Eagle");
});
