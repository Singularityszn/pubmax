// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import RouteList from "@/components/map/route/RouteList";
import { slimVenueToPin } from "@/lib/slimPins";
import type { Venue } from "@/lib/venues";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function venue(overrides: Partial<Venue>): Venue {
  return {
    ...slimVenueToPin({ id: "v1", name: "The Test Arms", lat: 51.5, lng: -0.1, cheapestPrice: 6, borough: "Camden" }),
    cheapestPint: "Lager",
    ...overrides,
  };
}

async function stopLine(stop: Venue, latestContributorPrice: number | null): Promise<string> {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(RouteList, {
    route: [stop],
    activeVenueId: undefined,
    venueSignals: new Map([[stop.id, { hasPintDrops: latestContributorPrice !== null, latestContributorPrice }]]),
    legSummary: { legs: [], totalKm: 0, totalMinutes: 0, pace: "walk" },
    onTheWayByLeg: new Map(),
    onSelectVenue: () => {},
  })));
  const text = host.querySelector(".routeList p")?.textContent ?? "";
  await act(async () => root.unmount());
  return text;
}

it("prints the baseline price beside the baseline drink when no drop has earned the map", async () => {
  expect(await stopLine(venue({}), null)).toBe("£6.00 · Lager");
});

it("prints a drop priced above the baseline without the baseline drink", async () => {
  expect(await stopLine(venue({ latestContributorPrice: 7.5 }), 7.5)).toBe("£7.50");
});

it("prints the cheapest drop beside the drink it names", async () => {
  expect(await stopLine(venue({ cheapestPrice: 4.5, cheapestPint: "Guinness", latestContributorPrice: 4.5 }), 4.5))
    .toBe("£4.50 · Guinness");
});

it("prints a cheapest drop that names no drink as the price alone", async () => {
  expect(await stopLine(venue({ cheapestPrice: 4.5, cheapestPint: "", latestContributorPrice: 4.5 }), 4.5))
    .toBe("£4.50");
});
