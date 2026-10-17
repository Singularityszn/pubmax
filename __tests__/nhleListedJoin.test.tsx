// @vitest-environment jsdom

// THE NHLE LISTING REACHES EVERY LONDON PUB THE JOIN MATCHES, WITH ITS SOURCE
// AND THE DAY IT WAS READ (owner decision, 16 Oct 2026).
//
// scripts/build_heritage_listings.mjs matches Historic England's listed-building
// points to the curated dataset AND to every London OSM pub no curated venue
// owns, keyed by the `venue-uk-<osmRef>` id that pub's base sheet opens under.
// The read day is the registry's heritage_listings stamp (a regenerated pack
// carries `$retrievedAt`); the Lore tab and the base sheet print it beside the
// fact. A pub with no listing in the pack gets nothing, never
// "not listed".

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildListings,
  parseRead,
  serialise,
  serialiseRead,
  VERIFIED_LISTINGS,
} from "@/scripts/build_heritage_listings.mjs";
import { baseRowOwners, baseVenueIdFor, LONDON_BOX, londonBaseVenues } from "@/scripts/lib/heritageBaseVenues.mjs";
import { heritageReadLabel, sanitizeHeritageFacts } from "@/lib/heritageFacts";
import { resolveObservedAt } from "@/lib/freshness";
import { getListedBuilding } from "@/lib/heritageListings";
import VenueListedBuilding from "@/components/map/VenueListedBuilding";
import { READ_PHASE_DELAY_MS } from "@/lib/useStaggeredRead";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = process.cwd();

describe("the London base pubs the join reads", () => {
  it("takes every named London pub no curated venue owns, under its base sheet id", () => {
    const venues = londonBaseVenues([
      { osmId: "node/1", amenity: "pub", name: "The George", lat: 51.5, lng: -0.1 },
      { osmId: "way/2", amenity: "pub", name: "The Crown", lat: 51.51, lng: -0.12 },
      { osmId: "node/3", amenity: "pub", name: "Owned", lat: 51.5, lng: -0.1, curatedRef: { id: "venue-x" } },
      { osmId: "node/4", amenity: "pub", name: "Leeds", lat: 53.8, lng: -1.55 },
      { osmId: "node/5", amenity: "pub", name: "  ", lat: 51.5, lng: -0.1 },
      { osmId: "node/6", amenity: "bar", name: "A Bar", lat: 51.5, lng: -0.1 },
      { osmId: "node/1", amenity: "pub", name: "The George", lat: 51.5, lng: -0.1 },
    ]);
    expect(venues).toEqual([
      { id: "venue-uk-n1", name: "The George", lat: 51.5, lng: -0.1 },
      { id: "venue-uk-w2", name: "The Crown", lat: 51.51, lng: -0.12 },
    ]);
    expect(baseVenueIdFor("relation/9")).toBe("venue-uk-r9");
    expect(baseVenueIdFor("node/0")).toBeNull();
  });

  it("leaves out a base pub the base layer gives to a curated venue", () => {
    const ownedBy = baseRowOwners([
      {
        pubs: [
          ["n1", "Masons Arms", "", 51.5, -0.1, "venue-jjzydh"],
          ["w2", "The Crown", "", 51.51, -0.12, ""],
          ["n7", "A Bar", "", 51.5, -0.1, "", "bar"],
        ],
      },
      { pubs: "not rows" },
    ]);
    expect([...ownedBy]).toEqual([["n1", "venue-jjzydh"]]);
    const venues = londonBaseVenues(
      [
        { osmId: "node/1", amenity: "pub", name: "Masons Arms", lat: 51.5, lng: -0.1 },
        { osmId: "way/2", amenity: "pub", name: "The Crown", lat: 51.51, lng: -0.12 },
      ],
      { ownedBy },
    );
    expect(venues.map((venue) => venue.id)).toEqual(["venue-uk-w2"]);
  });

  it("never lists a building under a base pin the map hides behind a curated pin it also lists", () => {
    const pack = JSON.parse(readFileSync(join(ROOT, "public/data/heritage_listings.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(join(ROOT, "public/data/uk_base/manifest.json"), "utf8"));
    const prefix = String(manifest.urlPrefix).replace(/^\/+/, "");
    const owners = baseRowOwners(
      manifest.shards
        .filter(
          ({ bbox: [minLng = 0, minLat = 0, maxLng = 0, maxLat = 0] }: { bbox: number[] }) =>
            minLng < LONDON_BOX.maxLng &&
            maxLng > LONDON_BOX.minLng &&
            minLat < LONDON_BOX.maxLat &&
            maxLat > LONDON_BOX.minLat,
        )
        .map(({ id }: { id: string }) => JSON.parse(readFileSync(join(ROOT, "public", prefix, `${id}.json`), "utf8"))),
    );
    const doubled = Object.keys(pack.listings).filter((id) => {
      const owner = id.startsWith("venue-uk-") ? owners.get(id.slice("venue-uk-".length)) : undefined;
      return owner !== undefined && owner in pack.listings;
    });
    expect(doubled).toEqual([]);
  });

  it("is a few thousand pubs in the committed snapshot", () => {
    const seed = JSON.parse(readFileSync(join(ROOT, "data/osm/uk/uk_osm_pubs.json"), "utf8"));
    const venues = londonBaseVenues(seed.pubs);
    expect(venues.length).toBeGreaterThan(2000);
    expect(venues.every((venue) => /^venue-uk-[nwr][1-9]\d*$/.test(venue.id))).toBe(true);
  });

  it("gives a matched base pub the official listing under its own id", () => {
    const listings = buildListings(
      [
        { id: "venue-uk-n1", name: "The George", lat: 51.50001, lng: -0.10001 },
        { id: "venue-uk-n2", name: "The Crown", lat: 51.6, lng: -0.2 },
      ],
      [
        { listEntry: 1065000, name: "THE GEORGE PUBLIC HOUSE", grade: "II*", listDate: Date.UTC(1972, 5, 1), lat: 51.5, lng: -0.1 },
        // Far from The Crown: a name alone never makes a listing.
        { listEntry: 1065001, name: "THE CROWN", grade: "II", listDate: null, lat: 51.4, lng: 0.1 },
      ],
    );
    expect(Object.keys(listings)).toEqual(["venue-uk-n1"]);
    expect(listings["venue-uk-n1"]).toMatchObject({
      listEntry: 1065000,
      grade: "II*",
      listedYear: 1972,
      url: "https://historicengland.org.uk/listing/the-list/list-entry/1065000",
    });
  });

  it("writes the day the NHLE was read, and refuses a read with no day", () => {
    const doc = JSON.parse(serialise({}, "2026-10-16T09:00:00.000Z"));
    expect(doc.$retrievedAt).toBe("2026-10-16T09:00:00.000Z");
    expect(doc.$licence).toBe("Open Government Licence v3.0");
    expect(() => serialise({}, "")).toThrow(/day it was read/);
  });

  it("finds a pinned listing for a venue whose kept name lost the listing's name, only on the venue", () => {
    const [[venueId, listEntry]] = Object.entries(VERIFIED_LISTINGS);
    const point = { listEntry, name: "OLD SHADES PUBLIC HOUSE", grade: "II", listDate: null, lat: 51.5, lng: -0.1 };
    const near = buildListings([{ id: venueId, name: "Unrelated Name", lat: 51.50001, lng: -0.10001 }], [point]);
    expect(near[venueId]).toMatchObject({ listEntry, grade: "II", name: "Old Shades Public House" });
    // A pin names a list entry, never a place: a point off the venue is no match.
    const far = buildListings([{ id: venueId, name: "Unrelated Name", lat: 51.51, lng: -0.1 }], [point]);
    expect(far).toEqual({});
  });
});

describe("the committed NHLE read", () => {
  const read = JSON.parse(readFileSync(join(ROOT, "data/heritage/nhle_london_points.json"), "utf8"));
  const pack = JSON.parse(readFileSync(join(ROOT, "public/data/heritage_listings.json"), "utf8"));

  it("is the read the pack was built from", () => {
    expect(read.$retrievedAt).toBe(pack.$retrievedAt);
    const byEntry = new Map(parseRead(read).points.map((point) => [point.listEntry, point]));
    for (const listing of Object.values(pack.listings) as Array<{ listEntry: number; grade: string }>) {
      expect(byEntry.get(listing.listEntry)?.grade.trim()).toBe(listing.grade);
    }
  });

  it("round-trips one sorted row a line", () => {
    const points = [
      { listEntry: 2, name: "B", grade: "II", listDate: 0, lat: 51.5, lng: -0.1 },
      { listEntry: 1, name: "A", grade: "I", listDate: null, lat: 51.4, lng: -0.2 },
    ];
    const text = serialiseRead(points, "2026-10-17T00:00:00.000Z");
    expect(text).toContain('\n    [1,"A","I",null,51.4,-0.2],\n    [2,"B","II",0,51.5,-0.1]\n');
    expect(parseRead(JSON.parse(text))).toEqual({
      retrievedAt: "2026-10-17T00:00:00.000Z",
      points: [points[1], points[0]],
    });
    expect(() => serialiseRead(points, "")).toThrow(/day it was read/);
  });
});

describe("the dated source reaches the sheet", () => {
  it("is the day the freshness registry holds the pack to", () => {
    const pack = JSON.parse(readFileSync(join(ROOT, "public/data/heritage_listings.json"), "utf8"));
    const registry = JSON.parse(readFileSync(join(ROOT, "data/freshness_registry.json"), "utf8"));
    const row = registry.datasets.find((dataset: { id: string }) => dataset.id === "heritage_listings");
    const readDay = resolveObservedAt(row.stamp, pack);
    expect(Number.isFinite(Date.parse(readDay ?? ""))).toBe(true);
  });

  it("rides every listing the reader returns", async () => {
    const pack = JSON.parse(readFileSync(join(ROOT, "public/data/heritage_listings.json"), "utf8"));
    const registry = JSON.parse(readFileSync(join(ROOT, "data/freshness_registry.json"), "utf8"));
    const row = registry.datasets.find((dataset: { id: string }) => dataset.id === "heritage_listings");
    const [venueId] = Object.keys(pack.listings);
    const listed = await getListedBuilding(venueId);
    expect(listed?.retrievedAt).toBe(resolveObservedAt(row.stamp, pack));
    expect(await getListedBuilding("venue-not-in-the-pack")).toBeNull();
  });

  it("survives the client sanitiser only as a real date, and prints as a read day", () => {
    const facts = sanitizeHeritageFacts([
      { source: "nhle", fact: "Grade II listed public house.", sourceRef: "https://historicengland.org.uk/x", observedAt: "2026-07-18T00:00:00Z" },
      { source: "nhle", fact: "Grade I listed.", observedAt: "last summer" },
    ]);
    expect(facts[0]?.observedAt).toBe("2026-07-18T00:00:00Z");
    expect(facts[1]?.observedAt).toBeUndefined();
    expect(heritageReadLabel("2026-07-18T00:00:00Z")).toBe("read 18 Jul 2026");
    expect(heritageReadLabel(undefined)).toBeNull();
  });
});

describe("the base pub sheet line", () => {
  let root: Root;
  let container: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function show(facts: unknown[]) {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
      new Response(JSON.stringify({ facts }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    act(() => root.render(createElement(VenueListedBuilding, { venueId: "venue-uk-n1", venueName: "The George" })));
    await act(async () => {
      vi.advanceTimersByTime(READ_PHASE_DELAY_MS[2]);
      await Promise.resolve();
    });
    for (let i = 0; i < 6; i += 1) await act(async () => Promise.resolve());
    return fetchMock;
  }

  it("prints the listing, who published it, the day it was read and the list entry", async () => {
    const fetchMock = await show([
      { source: "wikidata", fact: "Built in 1676." },
      {
        source: "nhle",
        fact: "Grade II* listed public house.",
        sourceRef: "https://historicengland.org.uk/listing/the-list/list-entry/1065000",
        observedAt: "2026-07-18T00:00:00Z",
      },
    ]);
    const line = container.querySelector(".unverifiedPubListed");
    expect(line?.querySelector(".unverifiedPubListedFact")?.textContent).toBe("Grade II* listed public house.");
    expect(line?.querySelector(".unverifiedPubListedSource")?.textContent).toBe(
      "Historic England NHLE (Open Government Licence v3.0), read 18 Jul 2026 · List entry",
    );
    expect(line?.querySelector("a")?.getAttribute("href")).toBe(
      "https://historicengland.org.uk/listing/the-list/list-entry/1065000",
    );
    expect(container.textContent).not.toContain("Built in 1676");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/heritage?venueId=venue-uk-n1&venueName=The+George");
  });

  it("renders nothing when the pack holds no listing for the pub", async () => {
    await show([{ source: "wikidata", fact: "Built in 1676." }]);
    expect(container.innerHTML).toBe("");
  });
});
