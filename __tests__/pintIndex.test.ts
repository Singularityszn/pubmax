import { describe, it, expect } from "vitest";

import {
  buildLeagueTable,
  leagueTableToCsv,
  indexSummary,
  LEAGUE_CSV_HEADER,
  type LeagueRow,
} from "@/lib/pintIndex";
import type { Venue } from "@/lib/venues";

// buildLeagueTable reads name/cheapestPrice/primaryBorough/visibleBoroughs (via
// leaderboard.venueArea). A partial cast keeps fixtures readable.
function v(
  over: Partial<Venue> & {
    id: string;
    name: string;
    cheapestPrice: number | null;
    primaryBorough: string;
  },
): Venue {
  return { visibleBoroughs: [], cheapestPint: "", ...over } as Venue;
}

const VENUES: Venue[] = [
  v({ id: "1", name: "Cheap A", cheapestPrice: 5.0, primaryBorough: "Hackney" }),
  v({ id: "2", name: "Cheap B", cheapestPrice: 6.0, primaryBorough: "Hackney" }),
  v({ id: "3", name: "Posh A", cheapestPrice: 8.0, primaryBorough: "Westminster" }),
  v({ id: "4", name: "Posh B", cheapestPrice: 9.0, primaryBorough: "Westminster" }),
  // A borough with no priced pub — listed, but sorts last with null figures.
  v({ id: "5", name: "Unknown", cheapestPrice: null, primaryBorough: "Bexley" }),
];

describe("buildLeagueTable", () => {
  it("aggregates per borough and sorts by cheapest average first", () => {
    const rows = buildLeagueTable(VENUES);
    expect(rows.map((r) => r.name)).toEqual(["Hackney", "Westminster", "Bexley"]);

    const hackney = rows[0];
    expect(hackney.averageGbp).toBe(5.5); // (5 + 6) / 2
    expect(hackney.minGbp).toBe(5.0);
    expect(hackney.minPubName).toBe("Cheap A");
    expect(hackney.maxGbp).toBe(6.0);
    expect(hackney.pubCount).toBe(2);

    const westminster = rows[1];
    expect(westminster.averageGbp).toBe(8.5);
  });

  it("lists price-less boroughs last with null figures (never invented)", () => {
    const rows = buildLeagueTable(VENUES);
    const bexley = rows[rows.length - 1];
    expect(bexley.name).toBe("Bexley");
    expect(bexley.averageGbp).toBeNull();
    expect(bexley.minGbp).toBeNull();
    expect(bexley.pubCount).toBe(0);
    expect(bexley.totalPubCount).toBe(1);
  });
});

describe("indexSummary", () => {
  it("computes a pub-weighted city average and cheapest/dearest boroughs", () => {
    const summary = indexSummary(buildLeagueTable(VENUES));
    expect(summary.boroughCount).toBe(2); // priced boroughs only
    expect(summary.pubCount).toBe(4);
    // Pub-weighted: (5 + 6 + 8 + 9) / 4 = 7.00
    expect(summary.averageGbp).toBe(7.0);
    expect(summary.cheapestBorough?.name).toBe("Hackney");
    expect(summary.dearestBorough?.name).toBe("Westminster");
  });

  it("is null-safe when no borough has a price", () => {
    const rows: LeagueRow[] = [
      {
        slug: "x",
        name: "X",
        pubCount: 0,
        totalPubCount: 3,
        averageGbp: null,
        minGbp: null,
        minPubName: null,
        maxGbp: null,
      },
    ];
    const summary = indexSummary(rows);
    expect(summary.averageGbp).toBeNull();
    expect(summary.cheapestBorough).toBeNull();
  });
});

describe("leagueTableToCsv", () => {
  it("emits a header plus one row per borough, prices to pence", () => {
    const csv = leagueTableToCsv(buildLeagueTable(VENUES));
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(LEAGUE_CSV_HEADER.join(","));
    expect(lines).toHaveLength(4); // header + 3 boroughs
    expect(lines[1]).toBe("Hackney,2,2,5.50,5.00,Cheap A,6.00");
    // Price-less borough → empty numeric fields, never a fabricated 0.
    expect(lines[3]).toBe("Bexley,0,1,,,,");
  });

  it("RFC-4180-quotes fields containing commas or quotes", () => {
    const rows: LeagueRow[] = [
      {
        slug: "s",
        name: "St. John's, Wood",
        pubCount: 1,
        totalPubCount: 1,
        averageGbp: 6.0,
        minGbp: 6.0,
        minPubName: 'The "Ivy" Arms',
        maxGbp: 6.0,
      },
    ];
    const csv = leagueTableToCsv(rows);
    const row = csv.trimEnd().split("\r\n")[1];
    expect(row).toContain('"St. John\'s, Wood"');
    expect(row).toContain('"The ""Ivy"" Arms"');
  });
});

describe("borough validation (SEO integrity)", () => {
  it("excludes venues whose primaryBorough is not a real borough", () => {
    const mixed = [
      v({ id: "1", name: "Real", cheapestPrice: 5, primaryBorough: "Camden" }),
      v({ id: "2", name: "SohoPub", cheapestPrice: 3, primaryBorough: "Soho" }),
      v({ id: "3", name: "MayfairPub", cheapestPrice: 9, primaryBorough: "Mayfair" }),
      v({ id: "4", name: "NoArea", cheapestPrice: 4, primaryBorough: "" }),
    ];
    const rows = buildLeagueTable(mixed);
    expect(rows.map((r) => r.name)).toEqual(["Camden"]);
    // The CSV can therefore never emit a non-borough row.
    const csv = leagueTableToCsv(rows);
    expect(csv).not.toMatch(/Soho|Mayfair/);
  });

  it("normalises ceremonial prefixes into one borough row", () => {
    const rows = buildLeagueTable([
      v({ id: "1", name: "A", cheapestPrice: 5, primaryBorough: "Greenwich" }),
      v({ id: "2", name: "B", cheapestPrice: 6, primaryBorough: "Royal Borough of Greenwich" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Greenwich", totalPubCount: 2 });
  });
});
