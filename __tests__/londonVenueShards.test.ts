// The London venue layer's decoder, and the fence that keeps it out of every
// pub system: a cafe on this layer may never wear a pub's id, a pub's price
// lane or a pub's label.

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { coveringStamp } from "../scripts/lib/coveringStamp.mjs";
import { londonVenuesToGeoJSON } from "@/components/map/canvas/geojson";
import { UK_BASE_ID_PREFIX } from "@/lib/ukBasePubs";
import {
  LONDON_VENUE_ID_PREFIX,
  LONDON_VENUE_MANIFEST_PATH,
  LONDON_VENUE_SHARD_VERSION,
  MAX_LONDON_VENUE_RESIDENT_SHARDS,
  WORK_SPOT_KINDS,
  createLondonVenueLoader,
  isLondonVenueId,
  londonVenueIdFor,
  londonVenuesOfKind,
  parseLondonVenueManifest,
  parseLondonVenueShard,
  parseLondonVenueShardForEntry,
} from "@/lib/londonVenueShards";
import {
  defaultVenueKindVisibility,
  filterVenuesByKind,
  isPubVenueKind,
} from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";

const CELL = "51.50_-0.25";

const publishedManifestPath = path.join(
  __dirname,
  "..",
  "public",
  "data",
  "london_venues",
  "manifest.json",
);

function shard(rows: unknown[]) {
  return { version: LONDON_VENUE_SHARD_VERSION, cell: CELL, venues: rows };
}

const CAFE = ["n1", "Desk & Bean", "1 Test Road, London", 51.51, -0.12, "cafe"];
const LIBRARY = ["w2", "Reading Room", "", 51.52, -0.11, "library"];

describe("London venue shard decoding", () => {
  it("decodes a kind-tagged row", () => {
    expect(parseLondonVenueShard(shard([CAFE, LIBRARY]))).toEqual([
      {
        id: "venue-osm-n1",
        name: "Desk & Bean",
        address: "1 Test Road, London",
        lat: 51.51,
        lng: -0.12,
        kind: "cafe",
      },
      {
        id: "venue-osm-w2",
        name: "Reading Room",
        address: "",
        lat: 51.52,
        lng: -0.11,
        kind: "library",
      },
    ]);
  });

  it("drops a row whose kind the vocabulary does not hold", () => {
    expect(parseLondonVenueShard(shard([["n3", "Mystery", "", 51.5, -0.1, "nightclub"]]))).toEqual(
      [],
    );
    expect(parseLondonVenueShard(shard([["n4", "Mystery", "", 51.5, -0.1, ""]]))).toEqual([]);
  });

  it("drops malformed rows rather than poisoning a reader", () => {
    expect(
      parseLondonVenueShard(
        shard([
          ["n5", "", "", 51.5, -0.1, "cafe"],
          ["n6", "No position", "", Number.NaN, -0.1, "cafe"],
          ["n7", "Short"],
          CAFE,
        ]),
      ).map((venue) => venue.id),
    ).toEqual(["venue-osm-n1"]);
  });

  it("refuses a shard body that disagrees with its manifest entry", () => {
    const entry = { id: CELL, count: 2, bbox: [-0.25, 51.5, 0, 51.75] as const, url: "x" };
    expect(parseLondonVenueShardForEntry(shard([CAFE, LIBRARY]), entry as never)).toHaveLength(2);
    expect(parseLondonVenueShardForEntry(shard([CAFE]), entry as never)).toBeNull();
    expect(
      parseLondonVenueShardForEntry({ ...shard([CAFE, LIBRARY]), cell: "elsewhere" }, entry as never),
    ).toBeNull();
    expect(
      parseLondonVenueShardForEntry({ ...shard([CAFE, LIBRARY]), version: 99 }, entry as never),
    ).toBeNull();
  });
});

describe("London venue map projection", () => {
  it("projects only neutral identity and kind properties", () => {
    const [feature] = londonVenuesToGeoJSON(parseLondonVenueShard(shard([CAFE]))).features;

    expect(feature).toEqual({
      type: "Feature",
      properties: {
        id: "venue-osm-n1",
        name: "Desk & Bean",
        address: "1 Test Road, London",
        kind: "cafe",
      },
      geometry: { type: "Point", coordinates: [-0.12, 51.51] },
    });
    expect(JSON.stringify(feature)).not.toContain("price");
    expect(JSON.stringify(feature)).not.toContain("bucket");
  });
});

describe("London venue viewport loading", () => {
  const realFetch = globalThis.fetch;
  const manifest = {
    version: LONDON_VENUE_SHARD_VERSION,
    urlPrefix: "/data/london_venues/packs/0123456789abcdef/",
    bbox: [-0.5, 51.25, 0.25, 51.75],
    grid: { originLat: 49.75, originLon: -8.75, latStep: 0.025, lonStep: 0.025 },
    shards: [
      { id: "near", core: false, count: 2, bbox: [-0.2, 51.4, -0.1, 51.5] },
      { id: "east", core: false, count: 1, bbox: [-0.1, 51.4, 0, 51.5] },
      { id: "far", core: false, count: 1, bbox: [0.1, 51.6, 0.2, 51.7] },
    ],
  };
  const bodies: Record<string, unknown> = {
    [LONDON_VENUE_MANIFEST_PATH]: manifest,
    "/data/london_venues/packs/0123456789abcdef/near.json": {
      version: LONDON_VENUE_SHARD_VERSION,
      cell: "near",
      venues: [
        ["n1", "Night Cafe", "1 Test Road", 51.45, -0.15, "cafe"],
        ["n2", "Duplicate Pub", "2 Test Road", 51.46, -0.14, "pub"],
      ],
    },
    "/data/london_venues/packs/0123456789abcdef/east.json": {
      version: LONDON_VENUE_SHARD_VERSION,
      cell: "east",
      venues: [["n3", "Late Counter", "", 51.45, -0.05, "food"]],
    },
    "/data/london_venues/packs/0123456789abcdef/far.json": {
      version: LONDON_VENUE_SHARD_VERSION,
      cell: "far",
      venues: [["n4", "Far Library", "", 51.65, 0.15, "library"]],
    },
  };
  let fetched: string[];
  let failed: Set<string>;

  beforeEach(() => {
    fetched = [];
    failed = new Set();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (failed.has(url)) throw new Error("network unavailable");
      if (!(url in bodies)) return new Response(null, { status: 404 });
      return Response.json(bodies[url]);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("fetches only intersecting cells and keeps pub rows out of the wider layer", async () => {
    const loader = createLondonVenueLoader();
    const venues = await loader.venuesForBounds({
      west: -0.19,
      south: 51.41,
      east: -0.11,
      north: 51.49,
    });

    expect(venues.map((venue) => venue.name)).toEqual(["Night Cafe"]);
    expect(fetched).toEqual([
      LONDON_VENUE_MANIFEST_PATH,
      "/data/london_venues/packs/0123456789abcdef/near.json",
    ]);

    fetched = [];
    await loader.venuesForBounds({ west: -0.19, south: 51.41, east: -0.11, north: 51.49 });
    expect(fetched).toEqual([]);
  });

  it("retries a failed shard on the next viewport settle", async () => {
    const nearUrl = "/data/london_venues/packs/0123456789abcdef/near.json";
    failed.add(nearUrl);
    const loader = createLondonVenueLoader();
    const bounds = { west: -0.19, south: 51.41, east: -0.11, north: 51.49 };

    expect(await loader.venuesForBounds(bounds)).toEqual([]);
    failed.delete(nearUrl);
    expect((await loader.venuesForBounds(bounds)).map((venue) => venue.name)).toEqual([
      "Night Cafe",
    ]);
    expect(fetched.filter((url) => url === nearUrl)).toHaveLength(2);
  });

  it("bounds resident shard memory", async () => {
    const loader = createLondonVenueLoader();
    await loader.venuesForBounds({ west: -0.2, south: 51.4, east: 0, north: 51.5 });
    await loader.venuesForBounds({ west: 0.1, south: 51.6, east: 0.2, north: 51.7 });

    expect(MAX_LONDON_VENUE_RESIDENT_SHARDS).toBeLessThanOrEqual(12);
    expect(loader.residentShardCount()).toBeLessThanOrEqual(
      MAX_LONDON_VENUE_RESIDENT_SHARDS,
    );
  });

  it("keeps residency capped when one viewport intersects more cells than the cap", async () => {
    const shardCount = MAX_LONDON_VENUE_RESIDENT_SHARDS + 1;
    const wideManifest = {
      ...manifest,
      shards: Array.from({ length: shardCount }, (_, index) => ({
        id: `cell-${index}`,
        core: false,
        count: 1,
        bbox: [index / 100, 51.4, (index + 1) / 100, 51.5],
      })),
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === LONDON_VENUE_MANIFEST_PATH) return Response.json(wideManifest);
      const id = url.match(/\/(cell-\d+)\.json$/)?.[1];
      if (!id) return new Response(null, { status: 404 });
      const index = Number(id.slice("cell-".length));
      return Response.json({
        version: LONDON_VENUE_SHARD_VERSION,
        cell: id,
        venues: [[`n${index}`, `Venue ${index}`, "", 51.45, index / 100, "cafe"]],
      });
    }) as typeof fetch;
    const loader = createLondonVenueLoader();

    expect(
      await loader.venuesForBounds({ west: 0, south: 51.4, east: 1, north: 51.5 }),
    ).toHaveLength(shardCount);
    expect(loader.residentShardCount()).toBe(MAX_LONDON_VENUE_RESIDENT_SHARDS);
  });
});

describe("London venue manifest", () => {
  const manifest = {
    version: LONDON_VENUE_SHARD_VERSION,
    urlPrefix: "/data/london_venues/packs/0123456789abcdef/",
    shards: [{ id: CELL, core: false, count: 2, bbox: [-0.25, 51.5, 0, 51.75] }],
  };

  it("expands each cell id to a URL under its own prefix", () => {
    const parsed = parseLondonVenueManifest(manifest);
    expect(parsed?.shards[0].url).toBe("/data/london_venues/packs/0123456789abcdef/51.50_-0.25.json");
  });

  it("refuses a prefix that is not this layer's", () => {
    expect(parseLondonVenueManifest({ ...manifest, urlPrefix: "/data/uk_base/" })).toBeNull();
    expect(parseLondonVenueManifest({ ...manifest, urlPrefix: "https://example.test/" })).toBeNull();
  });

  it("refuses a shard that carries its own URL or a traversing id", () => {
    expect(
      parseLondonVenueManifest({
        ...manifest,
        shards: [{ ...manifest.shards[0], url: "https://example.test/x.json" }],
      }),
    ).toBeNull();
    expect(
      parseLondonVenueManifest({ ...manifest, shards: [{ ...manifest.shards[0], id: "../secret" }] }),
    ).toBeNull();
  });
});

describe("the layer's covering stamp", () => {
  it("dates the layer by the OLDEST evidence it covers, never the freshest", () => {
    // The manifest's stamp covers the drink, food and work packs at once, and a
    // per-lane rebuild is supported, so rebuilding the drink pack alone must not
    // date the cafe and library rows beside it as today.
    expect(
      coveringStamp([
        "2026-08-16T04:01:27.583Z",
        "2026-07-02T09:00:00.000Z",
        "2026-08-01T00:00:00.000Z",
      ]),
    ).toBe("2026-07-02T09:00:00.000Z");
    expect(coveringStamp(["2026-08-16T04:01:27.583Z"])).toBe("2026-08-16T04:01:27.583Z");
  });

  it("goes undated rather than borrowing a stamp for a pack it cannot date", () => {
    expect(coveringStamp(["2026-08-16T04:01:27.583Z", undefined])).toBeNull();
    expect(coveringStamp(["2026-08-16T04:01:27.583Z", "last tuesday"])).toBeNull();
    expect(coveringStamp(["2026-08-16T04:01:27.583Z", 1_755_316_887_583])).toBeNull();
    expect(coveringStamp([])).toBeNull();
  });

  it("never claims the published layer is fresher than the run behind its packs", () => {
    // Both files are generated artifacts read here as the contracts they are.
    // What this pins is the DIRECTION the covering rule may move a stamp: the
    // packs come out of the run `venue_chunks.json` records, so the layer over
    // them may be older (a `--from-raw` rebuild, an unrebuilt lane) but never
    // newer, and never a build time. Which of several stamps wins is proved by
    // the unit tests above, which vary them; this one proves the wiring.
    const manifest = JSON.parse(readFileSync(publishedManifestPath, "utf8")) as {
      generatedFrom: { fetchedAt: string | null };
    };
    const run = JSON.parse(
      readFileSync(path.join(__dirname, "..", "data", "osm", "uk", "venue_chunks.json"), "utf8"),
    ) as { generatedAt: string; scope: string; missingChunks: string[] };

    expect(run.scope).toBe("all");
    expect(run.missingChunks).toEqual([]);
    const layerStamp = manifest.generatedFrom.fetchedAt;
    if (layerStamp !== null) {
      expect(Number.isFinite(Date.parse(layerStamp))).toBe(true);
      expect(Date.parse(layerStamp)).toBeLessThanOrEqual(Date.parse(run.generatedAt));
    }
  });
});

describe("the published manifest speaks one bbox order", () => {
  // The manifest is generated public output, so it is read here as the contract
  // it is. Its top-level bbox is the LAYER's window and every shards[].bbox is a
  // cell inside it, both in GeoJSON [minLng, minLat, maxLng, maxLat]: a document
  // that mixed lat-first and lng-first would have a reader intersecting the
  // layer window before loading shards match nothing at all.
  const manifestPath = publishedManifestPath;

  it("holds every shard cell inside the layer bbox, read lng-first", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      bbox: number[];
      shards: { id: string; bbox: number[] }[];
    };
    const [minLng, minLat, maxLng, maxLat] = manifest.bbox;
    expect(minLng).toBeLessThan(maxLng);
    expect(minLat).toBeLessThan(maxLat);
    expect(manifest.shards.length).toBeGreaterThan(0);

    for (const shardEntry of manifest.shards) {
      const [cellMinLng, cellMinLat, cellMaxLng, cellMaxLat] = shardEntry.bbox;
      expect(cellMaxLng).toBeGreaterThan(minLng);
      expect(cellMinLng).toBeLessThan(maxLng);
      expect(cellMaxLat).toBeGreaterThan(minLat);
      expect(cellMinLat).toBeLessThan(maxLat);
    }
  });

  it("carries every shard's own venues inside that shard's bbox", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      urlPrefix: string;
      shards: { id: string; bbox: number[] }[];
    };
    const publicRoot = path.join(__dirname, "..", "public");
    const sample = manifest.shards.slice(0, 12);
    for (const shardEntry of sample) {
      const [cellMinLng, cellMinLat, cellMaxLng, cellMaxLat] = shardEntry.bbox;
      const rows = parseLondonVenueShard(
        JSON.parse(
          readFileSync(
            path.join(publicRoot, `${manifest.urlPrefix}${shardEntry.id}.json`.slice(1)),
            "utf8",
          ),
        ),
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const venue of rows) {
        expect(venue.lng).toBeGreaterThanOrEqual(cellMinLng);
        expect(venue.lng).toBeLessThanOrEqual(cellMaxLng);
        expect(venue.lat).toBeGreaterThanOrEqual(cellMinLat);
        expect(venue.lat).toBeLessThanOrEqual(cellMaxLat);
      }
    }
  });
});

describe("the layer stays out of every pub system", () => {
  it("salts its ids apart from the curated and base conventions", () => {
    expect(LONDON_VENUE_ID_PREFIX).not.toBe(UK_BASE_ID_PREFIX);
    expect(isLondonVenueId(londonVenueIdFor("n1"))).toBe(true);
    expect(isLondonVenueId(`${UK_BASE_ID_PREFIX}n1`)).toBe(false);
    expect(isLondonVenueId("venue-123")).toBe(false);
  });

  it("carries no price field of any kind", () => {
    const [venue] = parseLondonVenueShard(shard([CAFE]));
    expect(Object.keys(venue).sort()).toEqual(["address", "id", "kind", "lat", "lng", "name"]);
  });

  it("holds work-spot kinds no pub surface will claim", () => {
    for (const kind of WORK_SPOT_KINDS) expect(isPubVenueKind(kind)).toBe(false);
    expect(
      londonVenuesOfKind(parseLondonVenueShard(shard([CAFE, LIBRARY])), ["library"]).map(
        (venue) => venue.name,
      ),
    ).toEqual(["Reading Room"]);
  });
});

// The layer as a reader actually receives it: every shipped shard, decoded by
// the real decoder, against the counts artifact the same run wrote. Both files
// are generated public output of one build, so a rebuild that quietly loses a
// cell, merges two cells onto one id, or drops a kind shows up here as a census
// that no longer matches. A 12-shard sample above cannot see any of that.
describe("the shipped London layer", () => {
  const publicRoot = path.join(__dirname, "..", "public");

  function decodeWholeLayer() {
    const manifest = parseLondonVenueManifest(
      JSON.parse(readFileSync(publishedManifestPath, "utf8")),
    );
    expect(manifest).not.toBeNull();
    const venues = [];
    for (const entry of manifest!.shards) {
      const body = JSON.parse(
        readFileSync(path.join(publicRoot, entry.url.slice(1)), "utf8"),
      );
      const decoded = parseLondonVenueShardForEntry(body, entry);
      expect(decoded, `shard ${entry.id} was refused by its own decoder`).not.toBeNull();
      venues.push(...decoded!);
    }
    return venues;
  }

  it("decodes every shard into the census the extraction recorded", () => {
    const venues = decodeWholeLayer();
    const census: Record<string, number> = {};
    for (const venue of venues) census[venue.kind] = (census[venue.kind] ?? 0) + 1;

    const counts = JSON.parse(
      readFileSync(
        path.join(__dirname, "..", "data", "osm", "uk", "venue_counts.json"),
        "utf8",
      ),
    ) as { london: { total: number; byKind: Record<string, number> } };

    expect(census).toEqual(counts.london.byKind);
    expect(venues.length).toBe(counts.london.total);
    // Ids are unique across the whole layer: a cell id formatted to too few
    // decimals used to collapse cells onto one another and merge their rows.
    expect(new Set(venues.map((venue) => venue.id)).size).toBe(venues.length);
  });

  it("offers the curated map filter its pub kinds and nothing else", () => {
    const venues = decodeWholeLayer();
    const shown = filterVenuesByKind(
      venues as unknown as Venue[],
      defaultVenueKindVisibility(),
    );
    const shownKinds = new Set(shown.map((venue) => venue.kind));
    expect([...shownKinds].sort()).toEqual(["bar", "food", "pub", "restaurant"]);
    // Every kind the OSM widening added stays out of the curated view, and
    // nothing but a pub answers the pub predicate.
    for (const venue of venues) {
      if (isPubVenueKind(venue.kind)) expect(venue.kind).toBe("pub");
    }
    expect(shown.length).toBeLessThan(venues.length);
  });
});
