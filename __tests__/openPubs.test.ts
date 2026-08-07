import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// prettier-ignore
import {
  OPEN_PUBS_MATCH_RADIUS_M,
  buildIdentityIndex,
  evaluateOpenPubsMatches,
  identityFromOsmPub,
  identityFromSlimVenue,
  matchOpenPubToIdentity,
  normalizeOpenPubsCells,
  parseOpenPubsCsv,
  parseCsvNull,
  // @ts-expect-error -- untyped .mjs module (resolves fine at runtime under vitest)
} from "../scripts/lib/openPubs.mjs";

const FIXTURE = readFileSync(
  join(__dirname, "fixtures/open_pubs_sample.csv"),
  "utf8",
);

const CURATED = [
  {
    id: "venue-xjf3n0",
    name: "Arnos Arms",
    lat: 51.6162,
    lng: -0.132117,
    layer: "curated" as const,
  },
  {
    id: "venue-1p5ftm3",
    name: "The Dove",
    lat: 51.4905,
    lng: -0.234857,
    layer: "curated" as const,
  },
  {
    id: "venue-16pnwmm",
    name: "Prospect of Whitby",
    lat: 51.5071,
    lng: -0.0511255,
    layer: "curated" as const,
  },
  {
    id: "venue-alrti6",
    name: "Ye Olde Cheshire Cheese",
    lat: 51.51442896,
    lng: -0.107211023,
    layer: "curated" as const,
  },
];

describe("parseOpenPubsCsv", () => {
  it("parses the headerless fixture into normalised rows", () => {
    const rows = parseOpenPubsCsv(FIXTURE);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      fsaId: 206633,
      name: "The Arnos Arms",
      postcode: "N11 1AN",
      localAuthority: "Enfield",
    });
    expect(rows[0].lat).toBeCloseTo(51.61624, 5);
    expect(rows[4].name).toBe("Unmatched Test Arms");
    expect(rows[5].lat).toBeNull();
    expect(rows[5].lng).toBeNull();
  });

  it("skips a leading fsa_id header row when present", () => {
    const withHeader = `fsa_id,name,address,postcode,easting,northing,latitude,longitude,local_authority\n${FIXTURE}`;
    expect(parseOpenPubsCsv(withHeader)).toHaveLength(6);
  });

  it("treats MySQL-style \\N as null", () => {
    expect(parseCsvNull("\\N")).toBeNull();
    expect(normalizeOpenPubsCells(["1", "Pub", "Addr", "E1 1AA", "0", "0", "\\N", "\\N", "X"])).toMatchObject({
      lat: null,
      lng: null,
    });
  });
});

describe("matchOpenPubToIdentity", () => {
  it("matches known London rows to curated identity within the radius gate", () => {
    const rows = parseOpenPubsCsv(FIXTURE);
    const index = buildIdentityIndex(CURATED);

    const arnos = matchOpenPubToIdentity(rows[0], index);
    expect(arnos).toMatchObject({
      id: "venue-xjf3n0",
      layer: "curated",
      matchType: "exact-name-distance",
    });
    expect(arnos.distanceM).toBeLessThanOrEqual(OPEN_PUBS_MATCH_RADIUS_M);

    const dove = matchOpenPubToIdentity(rows[1], index);
    expect(dove?.id).toBe("venue-1p5ftm3");

    const whitby = matchOpenPubToIdentity(rows[2], index);
    expect(whitby?.id).toBe("venue-16pnwmm");
    expect(whitby?.distanceM).toBeLessThan(30);

    const cheese = matchOpenPubToIdentity(rows[3], index);
    expect(cheese?.id).toBe("venue-alrti6");
  });

  it("refuses a far-away same-shape name and rows without coordinates", () => {
    const rows = parseOpenPubsCsv(FIXTURE);
    const index = buildIdentityIndex(CURATED);
    expect(matchOpenPubToIdentity(rows[4], index)).toBeNull();
    expect(matchOpenPubToIdentity(rows[5], index)).toBeNull();
  });

  it("prefers curated over OSM when both sit on the same pub", () => {
    const rows = parseOpenPubsCsv(FIXTURE);
    const osmTwin = identityFromOsmPub({
      osmId: "node/1",
      name: "Prospect of Whitby",
      lat: 51.5072,
      lng: -0.05107,
    });
    expect(osmTwin?.id).toBe("venue-uk-n1");
    const index = buildIdentityIndex([...CURATED, osmTwin]);
    const match = matchOpenPubToIdentity(rows[2], index);
    expect(match?.layer).toBe("curated");
    expect(match?.id).toBe("venue-16pnwmm");
  });
});

describe("evaluateOpenPubsMatches", () => {
  it("reports match rates without inventing prices or mutating inputs", () => {
    const rows = parseOpenPubsCsv(FIXTURE);
    const frozen = structuredClone(rows);
    const summary = evaluateOpenPubsMatches(rows, CURATED);

    expect(summary.rowsRead).toBe(6);
    expect(summary.withCoords).toBe(5);
    expect(summary.skippedNoCoords).toBe(1);
    expect(summary.matchedCurated).toBe(4);
    expect(summary.matchedOsm).toBe(0);
    expect(summary.unmatched).toBe(1);
    expect(summary.matchRateOfCoordsPct).toBe(80);
    expect(rows).toEqual(frozen);
    // No price field anywhere in the evaluation contract.
    expect(JSON.stringify(summary)).not.toMatch(/price/i);
  });

  it("maps slim venue helpers into curated identity candidates", () => {
    const c = identityFromSlimVenue({
      id: "venue-x",
      name: "Test Arms",
      lat: 51.5,
      lng: -0.1,
      filterHints: { searchText: "test arms e1" },
    });
    expect(c).toEqual({
      id: "venue-x",
      name: "Test Arms",
      lat: 51.5,
      lng: -0.1,
      address: "test arms e1",
      layer: "curated",
    });
    expect(identityFromSlimVenue({ id: 1, name: "x", lat: 1, lng: 2 })).toBeNull();
  });
});
