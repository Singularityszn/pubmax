import { describe, expect, it } from "vitest";

import {
  buildSportFixtureRows,
  londonWallClockToIso,
  SPORT_FIXTURES,
} from "../scripts/whatson/sportFixtures.mjs";
import { dedupeKey, dedupeRows, isValidWhatsOnRow, type WhatsOnRow } from "@/lib/whatsOn";

const ARKLES = {
  id: "sport-attr-gk-arkles",
  venueId: "venue-17ivo1z",
  placeName: "Arkles",
  lat: 53.4303544,
  lng: -2.9574746,
  kind: "sport",
  title: "Shows live sport",
  detail: "Greene King lists this pub as a live-sport venue.",
  source: { label: "Greene King", url: "https://www.greeneking.co.uk/pubs/merseyside/arkles" },
  observedAt: "2026-07-11T21:26:43.108Z",
  confidence: "listed",
};

const BARON = {
  id: "sport-attr-gk-baron-of-beef",
  venueId: "venue-19rm2vj",
  placeName: "Baron of Beef",
  lat: 52.2089164,
  lng: 0.1181145,
  kind: "sport",
  title: "Shows live sport",
  detail: "Greene King lists this pub as a live-sport venue.",
  source: { label: "Greene King", url: "https://www.greeneking.co.uk/pubs/cambridgeshire/baron-of-beef" },
  observedAt: "2026-07-11T21:26:43.108Z",
  confidence: "listed",
};

// No coordinates, no venueId — mirrors a Greene King record whose lat/lng were
// never resolved (gkVenueIdFromRecord returns null in that case).
const PROSPECT_NO_COORDS = {
  id: "sport-attr-gk-prospect-of-whitby",
  placeName: "Prospect of Whitby",
  kind: "sport",
  title: "Shows live sport",
  source: { label: "Greene King", url: "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby" },
  observedAt: "2026-07-11T21:26:43.108Z",
  confidence: "listed",
};

describe("londonWallClockToIso", () => {
  it("resolves a BST (summer, +01:00) wall-clock kickoff", () => {
    // 20:00 London on 14 Jul 2026 (BST) = 19:00Z.
    expect(londonWallClockToIso("2026-07-14", "20:00")).toBe("2026-07-14T20:00:00+01:00");
    expect(new Date(londonWallClockToIso("2026-07-14", "20:00")!).toISOString()).toBe(
      "2026-07-14T19:00:00.000Z",
    );
  });

  it("resolves a GMT (winter, +00:00) wall-clock kickoff — DST correctness", () => {
    // 15:00 London on 28 Dec 2026 (GMT, no DST) = 15:00Z.
    expect(londonWallClockToIso("2026-12-28", "15:00")).toBe("2026-12-28T15:00:00+00:00");
    expect(new Date(londonWallClockToIso("2026-12-28", "15:00")!).toISOString()).toBe(
      "2026-12-28T15:00:00.000Z",
    );
  });

  it("returns null on a malformed date or time rather than guessing", () => {
    expect(londonWallClockToIso("not-a-date", "20:00")).toBeNull();
    expect(londonWallClockToIso("2026-07-14", "25:99")).toBeNull();
    expect(londonWallClockToIso("2026-07-14", "bad")).toBeNull();
    expect(londonWallClockToIso(undefined, undefined)).toBeNull();
  });
});

describe("buildSportFixtureRows", () => {
  const observedAt = "2026-07-12T00:00:00.000Z";

  it("crosses every fixture against every screening pub", () => {
    const fixtures = [SPORT_FIXTURES[0]];
    const rows = buildSportFixtureRows({ attributeRows: [ARKLES, BARON], fixtures, observedAt });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.placeName).sort()).toEqual(["Arkles", "Baron of Beef"]);
  });

  it("emits the B1 row contract shape with confidence:'derived' and dual provenance", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [ARKLES],
      fixtures: [SPORT_FIXTURES[0]],
      observedAt,
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({
      id: "sport-fixture-wc2026-sf1-fra-esp-arkles",
      placeName: "Arkles",
      venueId: "venue-17ivo1z",
      lat: 53.4303544,
      lng: -2.9574746,
      kind: "sport",
      startsAt: "2026-07-14T20:00:00+01:00",
      title: "France v Spain — FIFA World Cup Semi-Final",
      source: { label: "Greene King", url: ARKLES.source.url },
      observedAt,
      confidence: "derived",
    });
    // Both provenances honestly present: the venue-specific screening source
    // (structured `source`) AND the fixture calendar source (named in prose).
    expect(row.detail).toContain("Greene King-listed");
    expect(row.detail).toContain("not confirmed by the venue");
    expect(row.detail).toContain("FIFA World Cup 2026 match schedule");
  });

  it("passes isValidWhatsOnRow (the spine's own guard)", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [ARKLES],
      fixtures: [SPORT_FIXTURES[0]],
      observedAt,
    });
    const now = Date.parse("2026-07-12T12:00:00.000Z");
    expect(isValidWhatsOnRow(rows[0] as unknown, now)).toBe(true);
  });

  it("omits venueId/lat/lng when the attribute row lacks coordinates (never invented)", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [PROSPECT_NO_COORDS],
      fixtures: [SPORT_FIXTURES[0]],
      observedAt,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("venueId");
    expect(rows[0]).not.toHaveProperty("lat");
    expect(rows[0]).not.toHaveProperty("lng");
  });

  it("drops a fixture whose kickoff cannot be resolved, rather than fabricating a time", () => {
    const badFixture = { ...SPORT_FIXTURES[0], kickoffLondonTime: "not-a-time" };
    const rows = buildSportFixtureRows({ attributeRows: [ARKLES], fixtures: [badFixture], observedAt });
    expect(rows).toHaveLength(0);
  });

  it("drops an attribute row with no placeName or no source url", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [{ ...ARKLES, placeName: undefined }, { ...ARKLES, source: {} }],
      fixtures: [SPORT_FIXTURES[0]],
      observedAt,
    });
    expect(rows).toHaveLength(0);
  });

  it("ignores non-sport attribute rows", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [{ ...ARKLES, kind: "quiz" }],
      fixtures: [SPORT_FIXTURES[0]],
      observedAt,
    });
    expect(rows).toHaveLength(0);
  });

  it("two fixtures x one pub produce two distinct, non-colliding rows", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [ARKLES],
      fixtures: SPORT_FIXTURES,
      observedAt,
    });
    expect(rows).toHaveLength(2);
    const keys = new Set(rows.map((r) => dedupeKey(r as WhatsOnRow)));
    expect(keys.size).toBe(2);
    expect(dedupeRows(rows as WhatsOnRow[])).toHaveLength(2);
  });

  it("dedupeRows collapses two rows that land on the same (place, kind, startsAt), keeping the freshest", () => {
    const rows = buildSportFixtureRows({
      attributeRows: [ARKLES],
      fixtures: [SPORT_FIXTURES[0]],
      observedAt,
    });
    const stale = { ...rows[0], id: "stale-dupe", observedAt: "2026-07-01T00:00:00.000Z", title: "stale" };
    const fresh = { ...rows[0], id: "fresh-dupe", observedAt: "2026-07-12T00:00:00.000Z", title: "fresh" };
    const deduped = dedupeRows([stale, fresh] as unknown as WhatsOnRow[]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].title).toBe("fresh");
  });
});

describe("SPORT_FIXTURES", () => {
  it("every fixture carries a real http(s) source and a resolvable kickoff", () => {
    for (const fixture of SPORT_FIXTURES) {
      expect(fixture.source.url).toMatch(/^https:\/\//);
      expect(londonWallClockToIso(fixture.kickoffLondonDate, fixture.kickoffLondonTime)).not.toBeNull();
    }
  });
});
