import { describe, expect, it } from "vitest";

import {
  boundsNameNowhere,
  shardsForBounds,
  SHARD_READ_MAX_SPAN_DEGREES,
  viewportNamesNowhere,
  SHARD_READ_MIN_ZOOM,
  type ShardManifest,
} from "../lib/slimShards";

/**
 * The read that asked for the whole city, pinned.
 *
 * `/map` fetched 331 same-origin requests before it was interactive, against a
 * ceiling of 160. 245 of them were London slim cells - the entire grid - and
 * 243 arrived inside one 250 ms burst, while the settled camera was an ordinary
 * zoom 12 city view.
 *
 * The cause is not the camera. MapLibre reports its own `maxBounds` as the
 * visible bounds until the camera settles, so a cold open briefly says it is
 * looking at the whole United Kingdom. `viewportNamesNowhere` cannot catch that:
 * it guards the PLACEHOLDER, centre [0, 0] at zoom 0, and UK bounds are a real
 * centre at a real zoom. So the read was taken literally, twice.
 */

/** The bounds MapLibre actually reported on a cold /map, to four decimals. */
const UK_WIDE_BOUNDS = {
  west: -7.9953707055061045,
  south: 49.7999999999991,
  east: 1.1953707055073153,
  north: 60.999999999999204,
};

/** The bounds the same run reported once the camera had settled on London. */
const LONDON_VIEWPORT_BOUNDS = {
  west: -0.15347396850603445,
  south: 51.474901836911414,
  east: -0.0865260314947136,
  north: 51.565053549084496,
};

describe("boundsNameNowhere", () => {
  it("refuses the country-wide bounds a cold map reports before it settles", () => {
    // The old behaviour read shards from exactly these bounds.
    expect(boundsNameNowhere(UK_WIDE_BOUNDS)).toBe(true);
  });

  it("admits the city viewport the same run settled on", () => {
    expect(boundsNameNowhere(LONDON_VIEWPORT_BOUNDS)).toBe(false);
  });

  it("catches a wide read a city-zoom camera reports, which is why it exists", () => {
    // Both guards are needed and neither replaces the other, but the line
    // between them moved. The viewport guard now refuses a country ZOOM too
    // (SHARD_READ_MIN_ZOOM), because a restored session is how a country-wide
    // viewport arrives and one measured 243 cell requests in the first second
    // of a warm `/map`. What it still cannot catch is the case this guard was
    // written for: MapLibre reporting its own maxBounds while the camera sits
    // at a perfectly ordinary city zoom, before it has settled.
    expect(
      viewportNamesNowhere({
        center: [
          (UK_WIDE_BOUNDS.west + UK_WIDE_BOUNDS.east) / 2,
          (UK_WIDE_BOUNDS.south + UK_WIDE_BOUNDS.north) / 2,
        ],
        zoom: 5,
      }),
    ).toBe(true);
    expect(
      viewportNamesNowhere({ center: [-0.1276, 51.5072], zoom: 12 }),
    ).toBe(false);
    expect(boundsNameNowhere(UK_WIDE_BOUNDS)).toBe(true);
  });

  it("refuses a viewport too wide for a pin to paint, and admits a city view", () => {
    // The floor is derived from SHARD_READ_MAX_SPAN_DEGREES: a 390px phone
    // spans 2 degrees at zoom 8.1, and no pin paints below zoom 12 anyway.
    expect(SHARD_READ_MIN_ZOOM).toBe(8);
    expect(
      viewportNamesNowhere({ center: [-3.4, 55.8], zoom: 4.9 }),
    ).toBe(true);
    expect(
      viewportNamesNowhere({ center: [-0.1276, 51.5072], zoom: 8 }),
    ).toBe(false);
  });

  it("leaves a generous margin above any real city view", () => {
    const citySpan = Math.abs(
      LONDON_VIEWPORT_BOUNDS.east - LONDON_VIEWPORT_BOUNDS.west,
    );
    // An order of magnitude, so a wider phone, a lower zoom or another city
    // cannot trip it.
    expect(SHARD_READ_MAX_SPAN_DEGREES).toBeGreaterThan(citySpan * 10);
  });

  it("treats bounds it cannot measure as naming nowhere", () => {
    expect(
      boundsNameNowhere({ west: Number.NaN, south: 0, east: 1, north: 1 }),
    ).toBe(true);
  });

  it("refuses on either axis alone", () => {
    expect(
      boundsNameNowhere({ west: -0.1, south: 40, east: 0.1, north: 55 }),
    ).toBe(true);
    expect(
      boundsNameNowhere({ west: -10, south: 51.4, east: 10, north: 51.6 }),
    ).toBe(true);
  });
});

/** A grid manifest shaped like London's: many small cells over the city. */
function londonGridManifest(): ShardManifest {
  const shards = [];
  for (let latStep = 0; latStep < 16; latStep += 1) {
    for (let lngStep = 0; lngStep < 16; lngStep += 1) {
      const south = 51.3 + latStep * 0.025;
      const west = -0.5 + lngStep * 0.05;
      shards.push({
        id: `cell-${latStep}-${lngStep}`,
        core: false,
        url: `/data/venues_slim.cell.${south}_${west}.json`,
        count: 10,
        bbox: [west, south, west + 0.05, south + 0.025] as [
          number,
          number,
          number,
          number,
        ],
        partition: "grid" as const,
      });
    }
  }
  return {
    version: 1,
    shards,
    grid: { latStep: 0.025, lonStep: 0.05 },
  } as unknown as ShardManifest;
}

describe("what the unguarded read actually cost", () => {
  it("would take the whole grid from the country-wide bounds", () => {
    // This is the old behaviour, stated as a number: every cell, on one call.
    const manifest = londonGridManifest();
    const picked = shardsForBounds(manifest, UK_WIDE_BOUNDS, 0, true);

    expect(picked).toHaveLength(manifest.shards.length);
    expect(picked.length).toBeGreaterThan(200);
  });

  it("takes a small neighbourhood from the settled city viewport", () => {
    const manifest = londonGridManifest();
    const picked = shardsForBounds(manifest, LONDON_VIEWPORT_BOUNDS, 1, true);

    // The point of the fix: the same manifest, a real viewport, a fraction of
    // the cells.
    expect(picked.length).toBeLessThan(manifest.shards.length / 4);
  });
});
