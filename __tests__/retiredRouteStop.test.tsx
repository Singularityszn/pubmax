import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { builtRouteRetiredStops } from "@/components/map/pubmap/useMapPlanCoordinator";
import RouteList from "@/components/map/route/RouteList";
import { buildRouteLegs } from "@/lib/routeLegs";
import type { Venue } from "@/lib/venues";

// A crawl link shared before the 2 October refresh can name a pub that has
// since left OpenStreetMap. The route leaves that stop out entirely, so it can
// never act as a live stop, and one line above the route names it.

function venue(id: string, name: string, latitude: number, retired = false): Venue {
  return {
    id,
    name,
    address: "",
    latitude,
    longitude: -1.9,
    primaryBorough: "Birmingham",
    visibleBoroughs: ["Birmingham"],
    prices: [],
    cheapestPrice: 5,
    cheapestPint: "Lager",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    ...(retired ? { retired: true as const } : {}),
  };
}

const A = venue("venue-bhm-a", "The Anchor", 52.47);
const B = venue("venue-bhm-b", "The Bell", 52.48);
const DUCK = venue("venue-bhm-17j3xm7", "The Duck", 52.9, true);

describe("a retired stop on a shared crawl link", () => {
  it("is named once above the route and is never a route stop", () => {
    const retiredStops = builtRouteRetiredStops([A.id, DUCK.id, B.id], new Map([[DUCK.id, DUCK]]));
    expect(retiredStops).toEqual([{ id: DUCK.id, name: "The Duck" }]);

    const route = [A, B];
    const html = renderToStaticMarkup(
      createElement(RouteList, {
        route,
        retiredStops,
        activeVenueId: undefined,
        venueSignals: new Map(),
        legSummary: buildRouteLegs(route),
        onTheWayByLeg: new Map(),
        onSelectVenue: () => {},
      }),
    );
    expect(html).toContain(
      '<p class="routeRetiredNote">1 stop on this crawl may have closed: The Duck</p>',
    );
    const names = [...html.matchAll(/<strong>([^<]+)/g)].map((match) => match[1]);
    expect(names).toEqual(["The Anchor", "The Bell"]);
    const numbers = [...html.matchAll(/class="stopNumber">(\d+)</g)].map((match) => match[1]);
    expect(numbers).toEqual(["1", "2"]);
  });

  it("prints no line for a crawl with every pub still on the map", () => {
    const html = renderToStaticMarkup(
      createElement(RouteList, {
        route: [A, B],
        retiredStops: builtRouteRetiredStops([A.id, B.id], new Map()),
        activeVenueId: undefined,
        venueSignals: new Map(),
        legSummary: buildRouteLegs([A, B]),
        onTheWayByLeg: new Map(),
        onSelectVenue: () => {},
      }),
    );
    expect(html).not.toContain("routeRetiredNote");
  });
});
