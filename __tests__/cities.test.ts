import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import {
  CITIES,
  DEFAULT_CITY_ID,
  getCity,
  listEnabledCities,
  parseCityId,
  pointInCityBounds,
  cityMaxBounds,
} from "@/lib/cities";
import { pointsInClearView, type ScreenInsets } from "./helpers/cameraFootprint";

describe("parseCityId", () => {
  it("accepts known ids case-insensitively and trims whitespace", () => {
    expect(parseCityId("london")).toBe("london");
    expect(parseCityId("Manchester")).toBe("manchester");
    expect(parseCityId("  GLASGOW  ")).toBe("glasgow");
  });

  it("returns null for unknown, empty, or missing input", () => {
    expect(parseCityId(null)).toBeNull();
    expect(parseCityId(undefined)).toBeNull();
    expect(parseCityId("")).toBeNull();
    expect(parseCityId("paris")).toBeNull();
    expect(parseCityId("lon don")).toBeNull();
  });
});

describe("getCity", () => {
  it("returns the matching city config", () => {
    expect(getCity("manchester").id).toBe("manchester");
    expect(getCity("manchester").displayName).toBe("Manchester");
  });

  it("falls back to London for unknown or missing ids", () => {
    expect(getCity(null).id).toBe(DEFAULT_CITY_ID);
    expect(getCity(undefined).id).toBe("london");
    expect(getCity("not-a-city").id).toBe("london");
    expect(getCity("")).toBe(CITIES.london);
  });
});

describe("pointInCityBounds", () => {
  it("accepts points inside London and rejects outside", () => {
    const london = CITIES.london;
    expect(pointInCityBounds(51.52, -0.12, london)).toBe(true);
    expect(pointInCityBounds(51.28, -0.55, london)).toBe(true); // SW corner
    expect(pointInCityBounds(51.72, 0.35, london)).toBe(true); // NE corner
    expect(pointInCityBounds(51.52, -0.56, london)).toBe(false);
    expect(pointInCityBounds(53.48, -2.24, london)).toBe(false); // Manchester
  });

  it("accepts points inside Manchester", () => {
    const manchester = CITIES.manchester;
    expect(pointInCityBounds(53.48, -2.24, manchester)).toBe(true);
    expect(pointInCityBounds(51.52, -0.12, manchester)).toBe(false);
  });
});

describe("listEnabledCities", () => {
  it("includes every city with a shipped OSM slim pack", () => {
    const enabled = listEnabledCities();
    expect(enabled.map((c) => c.id).sort()).toEqual([
      "bath",
      "birmingham",
      "bristol",
      "cambridge",
      "durham",
      "glasgow",
      "leeds",
      "liverpool",
      "llandudno",
      "london",
      "manchester",
      "oxford",
    ]);
    expect(enabled.every((c) => c.enabled)).toBe(true);
  });
});

describe("city config paths and labels", () => {
  it("keeps London on legacy data paths with Last Pint", () => {
    expect(CITIES.london.slimVenuesPath).toBe("/data/venues_slim.json");
    expect(CITIES.london.poisPath).toBe("/data/london_pois.json");
    expect(CITIES.london.transitLinesPath).toBe("/data/tfl_lines.json");
    expect(CITIES.london.lastRideLabel).toBe("Last Pint");
    expect(CITIES.london.mapView.zoom).toBe(12);
    expect(CITIES.london.mapView.pitch).toBe(38);
    expect(CITIES.london.mapView.bearing).toBe(-8);
  });

  it("puts other cities under /data/cities/{id}/ with city-specific last-ride labels", () => {
    expect(CITIES.manchester.slimVenuesPath).toBe(
      "/data/cities/manchester/venues_slim.json",
    );
    expect(CITIES.manchester.poisPath).toBe("/data/cities/manchester/pois.json");
    expect(CITIES.manchester.transitLinesPath).toBeNull();
    expect(CITIES.manchester.lastRideLabel).toBe("Last Tram");
    expect(CITIES.glasgow.lastRideLabel).toBe("Last Subway");
    expect(CITIES.glasgow.country).toBe("scotland");
    expect(CITIES.oxford.lastRideLabel).toBe("Last Train");
  });

  it("converts bounds to MapLibre maxBounds order [SW, NE]", () => {
    expect(cityMaxBounds(CITIES.london)).toEqual([
      [-0.55, 51.28],
      [0.35, 51.72],
    ]);
  });
});

describe("city opening view", () => {
  // The map area a first visitor can read. Phone: the top bar and lens chip
  // above, the location card, Plan button and tab bar below (the same band the
  // phone city fit pads by). Desktop: the pub list on the left, the toolbar and
  // location card on top.
  const screens: { name: string; width: number; height: number; insets: ScreenInsets }[] = [
    { name: "390x844", width: 390, height: 844, insets: { top: 184, right: 24, bottom: 190, left: 24 } },
    { name: "1440x900", width: 1440, height: 900, insets: { top: 230, right: 0, bottom: 0, left: 432 } },
  ];
  // A screen that shows this many pubs is full, so a large city may open on
  // its centre rather than all of itself.
  const SCREENFUL = 150;

  function cityPubs(slimVenuesPath: string): [number, number][] {
    const pack = JSON.parse(readFileSync(path.join(process.cwd(), "public", slimVenuesPath), "utf8")) as {
      rows: { lat: number; lng: number }[];
    };
    return pack.rows.map((row) => [row.lng, row.lat]);
  }

  it.each(listEnabledCities().map((city) => [city.id, city] as const))(
    "%s opens with at least half its pubs, or a screenful, clear of the chrome",
    (_id, city) => {
      const pubs = cityPubs(city.slimVenuesPath);
      const needed = Math.min(Math.ceil(pubs.length / 2), SCREENFUL);
      for (const screen of screens) {
        // A cold visit opens north-up while the location card waits, then turns
        // to the city's bearing. Both frames must show the pubs.
        for (const bearing of [0, city.mapView.bearing]) {
          const shown = pointsInClearView({ ...city.mapView, bearing }, screen, pubs);
          expect(shown, `${screen.name} at bearing ${bearing}`).toBeGreaterThanOrEqual(needed);
        }
      }
    },
  );
});
