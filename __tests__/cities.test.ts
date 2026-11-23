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
import { PHONE_OPENING_PADDING } from "@/lib/phoneOpeningFrame";
import { screenPoint } from "./helpers/cameraFootprint";

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
  // The map canvas and the band of it a first visitor can read while the
  // location card waits, measured on a production build. 390: the top bar and
  // Pints chip above, the card from y 548. 768 and 1440: the nav bar, toolbar
  // and card above, and at 1440 the pub list sits beside the canvas.
  // A phone opens with its camera padded to that band (lib/phoneOpeningFrame.ts),
  // so its pubs are held to the band's middle third rather than its middle 60%.
  const phone = {
    name: "390x844",
    width: 390,
    height: 844,
    freeTop: 112,
    freeBottom: 548,
    centreOffsetY: (PHONE_OPENING_PADDING.top - PHONE_OPENING_PADDING.bottom) / 2,
    band: [0.35, 0.65],
  };
  const screens = [
    phone,
    { name: "768x1024", width: 768, height: 1024, freeTop: 226, freeBottom: 1024, band: [0.2, 0.8] },
    { name: "1440x900", width: 1008, height: 900, freeTop: 226, freeBottom: 900, band: [0.2, 0.8] },
  ];
  // A screen that shows this many pubs is full, so a large city may open on
  // its centre rather than all of itself. A pack can also run on into the
  // next towns (Llandudno reaches Colwyn Bay), so the opening owes the visitor
  // the town they chose, not every pub.
  const SCREENFUL = 150;

  function cityPubs(slimVenuesPath: string): [number, number][] {
    const pack = JSON.parse(readFileSync(path.join(process.cwd(), "public", slimVenuesPath), "utf8")) as {
      rows: { lat: number; lng: number }[];
    };
    return pack.rows.map((row) => [row.lng, row.lat]);
  }

  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

  it.each(listEnabledCities().map((city) => [city.id, city] as const))(
    "%s opens with its pubs in the middle of the free map, not at an edge or under the card",
    (_id, city) => {
      const pubs = cityPubs(city.slimVenuesPath);
      const needed = Math.min(Math.ceil(pubs.length / 3), SCREENFUL);
      for (const screen of screens) {
        // A cold visit opens north-up while the location card waits, then turns
        // to the city's bearing. Both frames must show the pubs.
        for (const bearing of [0, city.mapView.bearing]) {
          const frame = `${screen.name} at bearing ${bearing}`;
          const freeHeight = screen.freeBottom - screen.freeTop;
          const shown = pubs
            .map((pub) => screenPoint({ ...city.mapView, bearing }, screen, pub))
            .filter((point): point is [number, number] => point !== null)
            .filter(([x, y]) => x >= 0 && x <= screen.width && y >= screen.freeTop && y <= screen.freeBottom);
          expect(shown.length, frame).toBeGreaterThanOrEqual(needed);
          const across = median(shown.map(([x]) => x)) / screen.width;
          const down = (median(shown.map(([, y]) => y)) - screen.freeTop) / freeHeight;
          expect(across, `${frame}: share of the free width left of the median pub`).toBeGreaterThanOrEqual(0.2);
          expect(across, `${frame}: share of the free width left of the median pub`).toBeLessThanOrEqual(0.8);
          expect(down, `${frame}: share of the free height above the median pub`).toBeGreaterThanOrEqual(screen.band[0]!);
          expect(down, `${frame}: share of the free height above the median pub`).toBeLessThanOrEqual(screen.band[1]!);
        }
      }
    },
  );

  it("pads a phone's opening camera to the band the chrome leaves free, so the city's centre lands in its middle", () => {
    expect(PHONE_OPENING_PADDING).toEqual({ top: phone.freeTop, right: 0, bottom: phone.height - phone.freeBottom, left: 0 });
    for (const city of listEnabledCities()) {
      const centre = screenPoint(city.mapView, phone, city.mapView.center);
      expect(centre?.[1], city.id).toBeCloseTo((phone.freeTop + phone.freeBottom) / 2, 6);
    }
  });
});
