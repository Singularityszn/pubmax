import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { builtRouteRetiredStops } from "@/components/map/pubmap/useMapPlanCoordinator";
import RouteList from "@/components/map/route/RouteList";
import { buildRouteLegs } from "@/lib/routeLegs";
import type { Venue } from "@/lib/venues";

// A crawl link shared before the 2 October refresh can name a pub that has
// since left OpenStreetMap. The link keeps that stop in its place: named, noted
// as possibly closed, drawn as no pin and walked past.

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
  it("keeps its place between the stops around it, named once as possibly closed", () => {
    const builtIds = [A.id, DUCK.id, B.id];
    const venueById = new Map([
      [A.id, A],
      [B.id, B],
    ]);
    const retiredStops = builtRouteRetiredStops(builtIds, venueById, new Map([[DUCK.id, DUCK]]));
    expect(retiredStops).toEqual([{ id: DUCK.id, name: "The Duck", beforeRouteIndex: 1 }]);

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
    const names = [...html.matchAll(/<strong>([^<]+)/g)].map((match) => match[1]);
    expect(names).toEqual(["The Anchor", "The Duck (may have closed)", "The Bell"]);
    const numbers = [...html.matchAll(/class="stopNumber">(\d+)</g)].map((match) => match[1]);
    expect(numbers).toEqual(["1", "2", "3"]);
    // The walk goes from The Anchor straight to The Bell: The Duck's last point
    // (well north of both) adds no distance, and it offers no directions.
    expect(buildRouteLegs(route).legs).toHaveLength(1);
    expect(html.match(/class="routeStopDirections"/g)).toHaveLength(2);
  });
});
