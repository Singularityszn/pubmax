import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CITIES, type CityId } from "@/lib/cities";
import { CITY_BOUNDS } from "@/lib/cityBounds.mjs";
import { getCityCapabilityProfile } from "@/lib/cityCapabilities";
import {
  DERIVED_NIGHT_AREA_SLUGS,
  getNightAreasForCity,
  isNightAreaRouteReady,
  nightAreasByCity,
  NIGHT_AREA_SLUGS,
} from "@/lib/nightAreas";
import { nightAreaPublishesPrices } from "@/lib/pricedLanding";
import { placesAreasForCity, placesPricesPill, placesCityRows } from "@/lib/places";
import derivedAreaData from "@/public/data/night_areas/uk_cities.json";
import {
  DERIVED_AREA_CITIES,
  MAX_AREAS_PER_CITY,
  MIN_AREA_PUBS,
  MIN_AREAS_PER_CITY,
  deriveCityAreas,
  haversineKm,
} from "../scripts/build_city_night_areas.mjs";
import { PLACE_NODE_CITIES } from "../scripts/fetch_city_place_nodes.mjs";
import { isBasePubRow } from "../scripts/build_city_night_areas.mjs";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = path.resolve(__dirname, "..");

type BasePub = { osmId: string; name: string; lat: number; lng: number };
type PlaceNode = { cityId: string; name: string; kind: string; lat: number; lng: number };

function loadBasePubs(): BasePub[] {
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, "public/data/uk_base/manifest.json"), "utf8"),
  ) as { urlPrefix: string };
  const packDir = path.join(
    ROOT,
    "public/data/uk_base/packs",
    path.basename(manifest.urlPrefix.replace(/\/+$/, "")),
  );
  const pubs: BasePub[] = [];
  for (const file of readdirSync(packDir).filter((name) => name.endsWith(".json"))) {
    const shard = JSON.parse(readFileSync(path.join(packDir, file), "utf8")) as {
      pubs?: Array<[string, string, string, number, number, string]>;
    };
    for (const row of shard.pubs ?? []) {
      if (!isBasePubRow(row)) continue;
      pubs.push({ osmId: String(row[0]), name: String(row[1]), lat: Number(row[3]), lng: Number(row[4]) });
    }
  }
  return pubs;
}

function loadPlaceNodes(): PlaceNode[] {
  return (
    JSON.parse(readFileSync(path.join(ROOT, "data/osm/cities/place_nodes.json"), "utf8")) as {
      places: PlaceNode[];
    }
  ).places;
}

const basePubs = loadBasePubs();
const placeNodes = loadPlaceNodes();

describe("derived city Night Areas", () => {
  it("names the four cities the captain asked for, and each is a real CityId", () => {
    expect(DERIVED_AREA_CITIES).toEqual(["manchester", "birmingham", "leeds", "bristol"]);
    for (const cityId of DERIVED_AREA_CITIES) {
      expect(Object.keys(CITIES)).toContain(cityId);
    }
  });

  it("asks Overpass for each city under the display name the app shows", () => {
    // The fetch tells a city's own place node from its neighbours' by NAME, so
    // a renamed city would silently lose its centre.
    for (const city of PLACE_NODE_CITIES) {
      expect(CITIES[city.id as CityId].displayName).toBe(city.name);
    }
  });

  it("registers every derived area in the catalogue, and nothing more", () => {
    const fromJson = derivedAreaData.areas.map((area) => area.slug).sort();
    expect([...DERIVED_NIGHT_AREA_SLUGS].sort()).toEqual(fromJson);
    for (const slug of DERIVED_NIGHT_AREA_SLUGS) {
      expect(NIGHT_AREA_SLUGS).toContain(slug);
    }
  });

  for (const cityId of DERIVED_AREA_CITIES) {
    describe(cityId, () => {
      const published = getNightAreasForCity(cityId as CityId);
      const rows = derivedAreaData.areas.filter((area) => area.cityId === cityId);

      it("pins the area list the base layer supports", () => {
        expect(rows.length).toBeGreaterThanOrEqual(MIN_AREAS_PER_CITY);
        expect(rows.length).toBeLessThanOrEqual(MAX_AREAS_PER_CITY);
        expect(published.map((area) => area.slug)).toEqual(rows.map((row) => row.slug));
        expect(published.map((area) => area.name)).toEqual(rows.map((row) => row.name));
        // A pinned list, so a rebuild that moves a name or a centre is a review
        // rather than a silent change under a reader who chose that city.
        expect(rows.map((row) => `${row.slug} ${row.name} ${row.radiusKm} ${row.pubCount}`))
          .toMatchSnapshot();
      });

      it("re-derives the same areas from the committed base layer", () => {
        const derived = deriveCityAreas(cityId, defined(CITY_BOUNDS[cityId]), basePubs, placeNodes);
        expect(derived).toEqual(rows);
      });

      it("keeps every counted pub inside its own area", () => {
        const box = defined(CITY_BOUNDS[cityId]);
        const cityPubs = basePubs.filter(
          (pub) =>
            pub.lat >= box.latMin && pub.lat <= box.latMax &&
            pub.lng >= box.lonMin && pub.lng <= box.lonMax,
        );
        for (const row of rows) {
          const inside = cityPubs.filter(
            (pub) => haversineKm(row.centre, pub) <= row.radiusKm,
          );
          // Every pub the row counts is inside the row's own radius, so the
          // count and the circle a reader sees are one promise. The circle may
          // hold MORE, because a pub sitting inside two areas belongs to the
          // nearer one alone.
          expect(inside.length).toBeGreaterThanOrEqual(row.pubCount);
          expect(row.pubCount).toBeGreaterThanOrEqual(MIN_AREA_PUBS);
        }
      });

      it("claims nothing the base layer does not state", () => {
        for (const area of published) {
          expect(area.transportAnchors).toEqual([]);
          expect(area.coverageStatus).toBe("discovered");
          expect(area.missingEvidence).toContain("price_coverage");
          expect(area.missingEvidence).toContain("transport_anchor");
          expect(area.recentSignals).toEqual([]);
          // Nothing here may reach route planning, a priced landing or the sitemap.
          expect(isNightAreaRouteReady(area)).toBe(false);
          expect(nightAreaPublishesPrices(area)).toBe(false);
        }
      });

      it("shows the areas on Places and still says prices are coming", () => {
        expect(placesAreasForCity(cityId as CityId).map((area) => area.slug))
          .toEqual(rows.map((row) => row.slug));
        const row = placesCityRows().find((candidate) => candidate.cityId === cityId)!;
        expect(row.areaCount).toBe(rows.length);
        expect(placesPricesPill(row)).toBe("Prices coming");
        expect(getCityCapabilityProfile(cityId).prices.availability).toBe("unavailable");
      });
    });
  }

  it("keeps London's own areas hand-curated and unchanged", () => {
    const london = getNightAreasForCity("london");
    expect(london).toHaveLength(20);
    for (const area of london) {
      expect(area.transportAnchors.length).toBeGreaterThan(0);
    }
  });

  it("groups every area under exactly one city for a picker", () => {
    const groups = nightAreasByCity();
    expect(groups.flatMap((group) => group.areas)).toHaveLength(NIGHT_AREA_SLUGS.length);
    expect(new Set(groups.map((group) => group.cityId)).size).toBe(groups.length);
  });
});
