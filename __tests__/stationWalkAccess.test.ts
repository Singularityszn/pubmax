import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { haversineMeters } from "@/lib/greatCircle.mjs";
import {
  cellKey,
  chooseByStreetWalk,
  parseStationWalkAccess,
  streetWalkMetres,
  type StationWalkAccess,
} from "@/lib/stationWalkAccess";

const ROOT = path.resolve(__dirname, "..");
const raw = JSON.parse(readFileSync(path.join(ROOT, "data", "station_walk_access.json"), "utf8"));

const FIXTURE: StationWalkAccess = {
  stations: [
    { name: "Tottenham Court Road", lat: 51.516211, lng: -0.13111 },
    { name: "Leicester Square", lat: 51.511291, lng: -0.128242 },
  ],
  cells: { "51.514,-0.132": [[0, 458], [1, 489]] },
};

describe("streetWalkMetres", () => {
  it("answers the street walk for a covered point and a station TfL agrees on", () => {
    // TfL's hub point for the station is not ours; 60 m apart is the same station.
    expect(streetWalkMetres({ lat: 51.514, lng: -0.132 }, { lat: 51.5167, lng: -0.1305 }, FIXTURE)).toBe(458);
  });

  it("looks a raw point up on the grid the browser rounds to", () => {
    expect(cellKey(51.51404, -0.13196)).toBe("51.514,-0.132");
    expect(streetWalkMetres({ lat: 51.51404, lng: -0.13196 }, FIXTURE.stations[1]!, FIXTURE)).toBe(489);
  });

  it("returns null outside the pilot, so the caller keeps the straight line", () => {
    expect(streetWalkMetres({ lat: 51.53, lng: -0.12 }, FIXTURE.stations[0]!, FIXTURE)).toBeNull();
  });

  it("returns null when TfL chose a station the cell cannot name", () => {
    // Holborn: a real station, but not one this cell holds a walk to.
    expect(streetWalkMetres({ lat: 51.514, lng: -0.132 }, { lat: 51.517236, lng: -0.119841 }, FIXTURE)).toBeNull();
  });

  it("is never shorter than the straight line", () => {
    const short: StationWalkAccess = { ...FIXTURE, cells: { "51.514,-0.132": [[0, 10]] } };
    const station = FIXTURE.stations[0]!;
    const straight = haversineMeters(51.514, -0.132, station.lat, station.lng);
    expect(streetWalkMetres({ lat: 51.514, lng: -0.132 }, station, short)).toBeCloseTo(straight, 6);
  });
});

describe("chooseByStreetWalk", () => {
  const from = { lat: 51.514, lng: -0.132 };
  const leicesterSquare = { id: "LSQ", lat: 51.5113, lon: -0.1281 };
  const tottenhamCourtRoad = { id: "TCR", lat: 51.5167, lon: -0.1305 };
  const holborn = { id: "HOL", lat: 51.517236, lon: -0.119841 };

  it("re-ranks TfL's candidates by street walk", () => {
    expect(chooseByStreetWalk(from, [leicesterSquare, tottenhamCourtRoad], FIXTURE)).toBe(tottenhamCourtRoad);
  });

  it("keeps TfL's first when it is already the shortest walk", () => {
    expect(chooseByStreetWalk(from, [tottenhamCourtRoad, leicesterSquare], FIXTURE)).toBe(tottenhamCourtRoad);
  });

  it("keeps TfL's order when its first choice has no street walk to compare", () => {
    expect(chooseByStreetWalk(from, [holborn, tottenhamCourtRoad], FIXTURE)).toBe(holborn);
  });

  it("ignores a candidate the table cannot name", () => {
    expect(chooseByStreetWalk(from, [leicesterSquare, holborn], FIXTURE)).toBe(leicesterSquare);
  });

  it("answers null for no candidates", () => {
    expect(chooseByStreetWalk(from, [], FIXTURE)).toBeNull();
  });
});

describe("parseStationWalkAccess", () => {
  it("drops entries that point past the station list or carry no distance", () => {
    const parsed = parseStationWalkAccess({
      stations: FIXTURE.stations,
      cells: { a: [[0, 100], [9, 100], [1, -5], [1, "x"]], b: [[7, 1]], c: "nope" },
    });
    expect(parsed.cells).toEqual({ a: [[0, 100]] });
  });

  it("reads a malformed table as empty rather than throwing", () => {
    expect(parseStationWalkAccess(null)).toEqual({ stations: [], cells: {} });
    expect(parseStationWalkAccess({ stations: [{ name: 1 }] })).toEqual({ stations: [], cells: {} });
  });
});

describe("data/station_walk_access.json", () => {
  const access = parseStationWalkAccess(raw);

  it("names its source, licence and builder", () => {
    expect(raw._provenance).toEqual(
      expect.objectContaining({
        source: expect.stringContaining("Overture"),
        release: expect.stringMatching(/^\d{4}-\d{2}-\d{2}\.\d+$/),
        licence: expect.stringContaining("OpenStreetMap"),
        builder: "scripts/build_station_walk_access.py",
      }),
    );
  });

  it("parses without losing a cell", () => {
    expect(Object.keys(access.cells).length).toBe(Object.keys(raw.cells).length);
    expect(Object.keys(access.cells).length).toBeGreaterThan(200);
  });

  it("keys every cell on the grid coarsenViewerPoint rounds to, inside the pilot", () => {
    const [minLng, minLat, maxLng, maxLat] = raw.pilot.grid as number[];
    for (const key of Object.keys(access.cells)) {
      const [lat, lng] = key.split(",").map(Number) as [number, number];
      expect(cellKey(lat, lng)).toBe(key);
      expect(lat).toBeGreaterThanOrEqual(minLat! - 1e-9);
      expect(lat).toBeLessThanOrEqual(maxLat! + 1e-9);
      expect(lng).toBeGreaterThanOrEqual(minLng! - 1e-9);
      expect(lng).toBeLessThanOrEqual(maxLng! + 1e-9);
    }
  });

  it("never holds a street walk shorter than the straight line, nor past its cap", () => {
    for (const [key, walks] of Object.entries(access.cells)) {
      const [lat, lng] = key.split(",").map(Number) as [number, number];
      let previous = 0;
      for (const [index, metres] of walks) {
        const station = access.stations[index]!;
        expect(metres + 1).toBeGreaterThanOrEqual(haversineMeters(lat, lng, station.lat, station.lng));
        expect(metres).toBeLessThanOrEqual(raw.maxWalkMetres);
        expect(metres).toBeGreaterThanOrEqual(previous);
        previous = metres;
      }
    }
  });

});
