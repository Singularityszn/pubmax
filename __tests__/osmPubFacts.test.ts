import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readOsmOpeningHours, parseOsmOpeningHours } from "@/lib/osmOpeningHours";
import { osmPubFactsFromRow, osmPubFactsView, type OsmPubFacts } from "@/lib/osmPubFacts";
import { osmFactsForOsmIds } from "@/lib/osmPubFacts.server";
import { OSM_PUB_FACTS_TRACING_INCLUDE } from "@/lib/osmPubFactsFile.mjs";
import { RUNTIME_DATA_PACKS } from "@/lib/venueIndexTracing.mjs";
import { buildOsmPubFacts } from "@/scripts/build_osm_pub_facts.mjs";
import { readOsmPubFacts } from "@/scripts/lib/osmPubNormalizer.mjs";

const PACK_PATH = path.join(process.cwd(), OSM_PUB_FACTS_TRACING_INCLUDE);
const pack = JSON.parse(readFileSync(PACK_PATH, "utf8"));

describe("readOsmPubFacts", () => {
  it("keeps each stated tag verbatim and prefers contact:* over the bare key", () => {
    expect(readOsmPubFacts({
      amenity: "pub",
      name: "Test Arms",
      opening_hours: "Mo-Su 12:00-23:00",
      wheelchair: "limited",
      live_sport: "yes",
      dog: "no",
      "contact:instagram": "testarms",
      instagram: "old_handle",
      "website:menu": "https://test.example/menu",
      check_date: "2024-05-03",
    })).toEqual({
      openingHours: "Mo-Su 12:00-23:00",
      wheelchair: "limited",
      liveSport: "yes",
      dog: "no",
      instagram: "testarms",
      menuUrl: "https://test.example/menu",
      checkDate: "2024-05-03",
    });
  });

  it("states nothing for a tag OSM does not state, and a check date alone is not a fact", () => {
    expect(readOsmPubFacts({ amenity: "pub", name: "Bare" })).toBeNull();
    expect(readOsmPubFacts({ amenity: "pub", check_date: "2024-05-03" })).toBeNull();
    const facts = readOsmPubFacts({ amenity: "pub", real_ale: "yes" });
    expect(facts).toEqual({ realAle: "yes" });
    expect(facts).not.toHaveProperty("dog");
  });
});

describe("buildOsmPubFacts", () => {
  const londonPub = (id: number, tags: Record<string, string>) => ({ type: "node", id, lat: 51.5, lon: -0.1, tags: { amenity: "pub", ...tags } });

  it("keeps London pubs once, dates each row from its chunk and the pack from the oldest chunk", () => {
    const body = buildOsmPubFacts([
      { timestamp: "2026-10-06T00:09:32Z", elements: [londonPub(1, { dog: "yes" }), { type: "node", id: 2, lat: 53.4, lon: -2.2, tags: { amenity: "pub", dog: "yes" } }] },
      { timestamp: "2026-10-05T22:52:59Z", elements: [londonPub(1, { dog: "no" }), londonPub(3, { live_sport: "yes" }), londonPub(4, { name: "No facts" })] },
      { timestamp: "2026-10-05T10:00:00Z", elements: [{ type: "node", id: 5, lat: 51.5, lon: -0.1, tags: { amenity: "bar", dog: "yes" } }] },
    ]);
    expect(body.rows).toEqual([
      { osmId: "node/1", readOn: "2026-10-06", dog: "yes" },
      { osmId: "node/3", readOn: "2026-10-05", liveSport: "yes" },
    ]);
    expect(body.extractedAt).toBe("2026-10-05T22:52:59Z");
    expect(body.counts).toMatchObject({ pubs: 3, withFacts: 2 });
    expect(body.licence).toMatchObject({ name: "ODbL-1.0", attribution: "© OpenStreetMap contributors" });
  });

  it("publishes no fact from an undated chunk", () => {
    const body = buildOsmPubFacts([{ timestamp: null, elements: [londonPub(1, { dog: "yes" })] }]);
    expect(body.rows).toEqual([]);
    expect(body.extractedAt).toBeNull();
  });
});

describe("the committed London pack", () => {
  it("is the ODbL pack the builder writes, dated and counted", () => {
    expect(pack.version).toBe(1);
    expect(pack.licence).toMatchObject({ name: "ODbL-1.0", copyrightUrl: "https://www.openstreetmap.org/copyright" });
    expect(pack.extractedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(pack.counts.pubs).toBe(3658);
    expect(pack.counts.fields).toMatchObject({
      openingHours: 1058,
      wheelchair: 822,
      liveSport: 1165,
      menuUrl: 155,
    });
  });

  it("holds OSM tag fields only, and every row reads back", () => {
    const allowed = new Set([
      "osmId", "readOn", "checkDate", "hoursCheckDate", "openingHours", "wheelchair", "liveSport",
      "outdoorSeating", "beerGarden", "realAle", "dog", "menuUrl", "facebook", "instagram", "twitter",
      "operator", "brand", "brewery",
    ]);
    for (const row of pack.rows) {
      for (const key of Object.keys(row)) expect(allowed.has(key), key).toBe(true);
      expect(osmPubFactsFromRow(row), row.osmId).not.toBeNull();
    }
  });

  it("is a declared runtime pack, so the routes that join it are deployed with it", () => {
    expect(RUNTIME_DATA_PACKS.find((entry) => entry.id === "osm-pub-facts")).toEqual({
      id: "osm-pub-facts",
      modules: ["lib/osmPubFacts.server.ts"],
      files: [OSM_PUB_FACTS_TRACING_INCLUDE],
    });
  });

  it("has a freshness registry row stamped from the pack", () => {
    const registry = JSON.parse(readFileSync(path.join(process.cwd(), "data/freshness_registry.json"), "utf8"));
    const row = registry.datasets.find((entry: { id: string }) => entry.id === "osm_pub_facts");
    expect(row).toMatchObject({
      artifact: OSM_PUB_FACTS_TRACING_INCLUDE.slice(2),
      stamp: { kind: "field", pointer: "extractedAt" },
    });
  });
});

describe("osmFactsForOsmIds", () => {
  it("joins one pub's facts by OSM id in any spelling, and states nothing for an unknown id", async () => {
    const facts = await osmFactsForOsmIds(["way/479277796"]);
    expect(facts).toMatchObject({ osmId: "way/479277796", wheelchair: "limited", liveSport: "yes" });
    expect(await osmFactsForOsmIds(["venue-uk-w479277796"])).toEqual(facts);
    expect(await osmFactsForOsmIds(["node/1"])).toBeNull();
    expect(await osmFactsForOsmIds([])).toBeNull();
  });

  it("shows neither when two of a venue's OSM ids both state facts", async () => {
    const [first, second] = pack.rows;
    expect(await osmFactsForOsmIds([first.osmId, second.osmId])).toBeNull();
    expect(await osmFactsForOsmIds([first.osmId, "node/1"])).toMatchObject({ osmId: first.osmId });
  });
});

describe("readOsmOpeningHours", () => {
  it("states only the days the string names; open state still reads an unnamed day as closed", () => {
    expect(readOsmOpeningHours("Mo-Fr 12:00-23:00; Su off")).toEqual({
      1: [{ opens: "12:00", closes: "23:00" }],
      2: [{ opens: "12:00", closes: "23:00" }],
      3: [{ opens: "12:00", closes: "23:00" }],
      4: [{ opens: "12:00", closes: "23:00" }],
      5: [{ opens: "12:00", closes: "23:00" }],
      0: [],
    });
    expect(parseOsmOpeningHours("Mo-Fr 12:00-23:00")?.[6]).toEqual([]);
  });

  it("reads nothing from a string with a rule it does not know", () => {
    expect(readOsmOpeningHours("Mo-Su 12:00-23:00; PH off")).toBeNull();
    expect(readOsmOpeningHours("12:00-23:00")).toBeNull();
    expect(readOsmOpeningHours("Mo-Sa 11:23:00; Su 12:00-22:00")).toBeNull();
  });

  it("reads nothing when one day list mixes a known day with a token it does not know", () => {
    // The committed pack states these. Keeping `Su` and dropping `PH` would
    // print a Sunday-only table and hide the public-holiday hours.
    const mixed: Record<string, string> = {
      "way/164010931": "Mo-Sa 12:00-23:00; Su,PH 12:00-19:00",
      "way/300860985": "Mo-Sa 12:00-23:00; Su, PH 12:00-22:00",
      // Ghost Whale, Atlantic Road, SW9.
      "node/11006274641": "Mo 16:00-20:00; Tu 16:00-21:00; We 16:00-23:00; Th-Sa 12:00-23:00; Su,PH 12:00-20:00",
    };
    for (const [osmId, openingHours] of Object.entries(mixed)) {
      expect(pack.rows.find((row: OsmPubFacts) => row.osmId === osmId)?.openingHours).toBe(openingHours);
      expect(readOsmOpeningHours(openingHours)).toBeNull();
      expect(parseOsmOpeningHours(openingHours)).toBeNull();
      const view = osmPubFactsView({ osmId, readOn: "2026-10-05", openingHours });
      expect(view?.hours).toBeNull();
      expect(view?.hoursRaw).toBe(openingHours);
    }
    expect(readOsmOpeningHours("Mo-Sa 12:00-23:00; Su,PH off")).toBeNull();
    expect(readOsmOpeningHours("Mo,Xx 12:00-23:00")).toBeNull();
  });
});

describe("osmPubFactsView", () => {
  const base: OsmPubFacts = { osmId: "node/1", readOn: "2026-10-05" };

  it("prints only stated facts, a stated no as absent, and an unknown value as OSM states it", () => {
    const view = osmPubFactsView({ ...base, wheelchair: "no", liveSport: "yes", dog: "outside", outdoorSeating: "patio" });
    expect(view?.chips).toEqual([
      { label: "Not wheelchair accessible", absent: true },
      { label: "Shows live sport", absent: false },
      { label: "Outdoor seating: patio", absent: false },
      { label: "Dogs outside only", absent: false },
    ]);
    expect(osmPubFactsView({ ...base, realAle: "yes" })?.chips).toEqual([{ label: "Real ale", absent: false }]);
  });

  it("credits a mapper's check date as checked, and the extract day as read", () => {
    expect(osmPubFactsView({ ...base, dog: "yes" })?.credit).toBe("OpenStreetMap, read 5 Oct 2026");
    expect(osmPubFactsView({ ...base, dog: "yes", checkDate: "2024-05-03" })?.credit).toBe("OpenStreetMap, checked 3 May 2024");
    expect(osmPubFactsView({ ...base, dog: "yes", checkDate: "2024-05" })?.credit).toBe("OpenStreetMap, checked May 2024");
    expect(osmPubFactsView({ ...base, openingHours: "Mo 12:00-23:00", checkDate: "2023-01-01", hoursCheckDate: "2025-06-30" })?.hoursCredit)
      .toBe("OpenStreetMap hours, checked 30 Jun 2025");
    expect(osmPubFactsView({ ...base, openingHours: "Mo 12:00-23:00" })?.hoursCredit).toBe("OpenStreetMap hours, read 5 Oct 2026");
  });

  it("prints hours per day when they read cleanly and as written when they do not", () => {
    const clean = osmPubFactsView({ ...base, openingHours: "Mo-Th 12:00-23:00" });
    expect(clean?.hours?.[1]).toEqual([{ opens: "12:00", closes: "23:00" }]);
    expect(clean?.hours?.[5]).toBeUndefined();
    expect(clean?.hoursRaw).toBeNull();
    const raw = osmPubFactsView({ ...base, openingHours: "Mo-Su 12:00-23:00; PH off" });
    expect(raw?.hours).toBeNull();
    expect(raw?.hoursRaw).toBe("Mo-Su 12:00-23:00; PH off");
  });

  it("links a menu and socials it can address, and drops what it cannot", () => {
    const view = osmPubFactsView({
      ...base,
      menuUrl: "test.example/menu",
      facebook: "https://www.facebook.com/testarms",
      instagram: "@testarms",
      twitter: "explore/locations/1 2",
    });
    expect(view?.links).toEqual([
      { label: "Facebook", href: "https://www.facebook.com/testarms" },
      { label: "Instagram", href: "https://www.instagram.com/testarms" },
    ]);
  });

  it("names who runs the pub, and drops a brewery value that names no brewery", () => {
    expect(osmPubFactsView({ ...base, operator: "Stonegate", brand: "Slug & Lettuce", brewery: "yes;various" })?.ownership).toEqual([
      { label: "Operator", value: "Stonegate" },
      { label: "Brand", value: "Slug & Lettuce" },
      { label: "Brewery", value: "Various" },
    ]);
    expect(osmPubFactsView({ ...base, brewery: "yes" })).toBeNull();
  });

  it("rejects a malformed row", () => {
    expect(osmPubFactsFromRow({ osmId: "node/1", readOn: "yesterday", dog: "yes" })).toBeNull();
    expect(osmPubFactsFromRow({ osmId: "pub-1", readOn: "2026-10-05", dog: "yes" })).toBeNull();
    expect(osmPubFactsFromRow({ osmId: "node/1", readOn: "2026-10-05", checkDate: "2024-05-03" })).toBeNull();
    expect(osmPubFactsFromRow({ osmId: "node/1", readOn: "2026-10-05", dog: "yes", checkDate: "last week" })).toEqual({
      osmId: "node/1",
      readOn: "2026-10-05",
      dog: "yes",
    });
  });
});
