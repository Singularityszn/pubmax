// The London venue layer's decoder, and the fence that keeps it out of every
// pub system: a cafe on this layer may never wear a pub's id, a pub's price
// lane or a pub's label.

import { describe, expect, it } from "vitest";

import { UK_BASE_ID_PREFIX } from "@/lib/ukBasePubs";
import {
  LONDON_VENUE_ID_PREFIX,
  LONDON_VENUE_SHARD_VERSION,
  WORK_SPOT_KINDS,
  isLondonVenueId,
  londonVenueIdFor,
  londonVenuesOfKind,
  parseLondonVenueManifest,
  parseLondonVenueShard,
  parseLondonVenueShardForEntry,
} from "@/lib/londonVenueShards";
import { isPubVenueKind } from "@/lib/venueKindFilters";

const CELL = "51.50_-0.25";

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
