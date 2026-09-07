import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { priceBandThresholdsFrom } from "@/lib/priceBand";
import {
  SPOONS_VALUE_BANDS,
  applySpoonsValueCut,
  bestValueRoundLine,
  formatBasketCost,
  formatRoundLine,
  formatUnits,
  formatUnitsLabel,
  modalMilliunits,
  parseSpoonsValueMapLane,
  parseSpoonsValuePack,
  spoonsValueBand,
  spoonsValueBandClass,
  spoonsValueBandLabel,
  spoonsValueBandLegendLabel,
  spoonsValueBucket,
  spoonsValueCuts,
  spoonsValueMapHref,
  spoonsValuePinFor,
  toTableRow,
  type SpoonsValuePack,
  type SpoonsValueRow,
} from "@/lib/spoonsValue";

const ROOT = process.cwd();

function loadPack(): SpoonsValuePack {
  const raw = JSON.parse(
    readFileSync(join(ROOT, "public", "data", "spoonme", "rows.json"), "utf8"),
  );
  const pack = parseSpoonsValuePack(raw);
  expect(pack).not.toBeNull();
  return pack as SpoonsValuePack;
}

describe("the imported edition", () => {
  const pack = loadPack();

  it("carries a credit on every figure it publishes", () => {
    expect(pack.provenance.author).toBe("Oliver Clegg");
    expect(pack.provenance.publisher).toBe("SpoonMe");
    expect(pack.provenance.sourceUrl).toBe("https://spoonme.vercel.app/report");
    expect(pack.provenance.publishedAt).toBe("2026-08-30");
    expect(Number.isNaN(Date.parse(pack.provenance.retrievedAt))).toBe(false);
    expect(pack.provenance.licence).toMatch(/no licence stated/i);
  });

  it("holds its own arithmetic: every basket re-costs and re-totals", () => {
    for (const row of pack.rows) {
      const pence = row.lines.reduce((sum, line) => sum + line.linePricePence, 0);
      const milliunits = row.lines.reduce((sum, line) => sum + line.lineMilliunits, 0);
      expect(pence).toBe(row.pence);
      expect(milliunits).toBe(row.milliunits);
      expect(pence).toBeLessThanOrEqual(pack.budgetPence);
    }
  });

  it("ranks by units, best first, with ties sharing a rank", () => {
    let previousUnits = Number.POSITIVE_INFINITY;
    let previousRank = 0;
    for (const row of pack.rows) {
      expect(row.milliunits).toBeLessThanOrEqual(previousUnits);
      expect(row.rankNumber).toBeGreaterThanOrEqual(previousRank);
      previousUnits = row.milliunits;
      previousRank = row.rankNumber;
    }
  });

  it("agrees with the rank the source published, on every row", () => {
    const disagreements = pack.rows.filter(
      (row) => row.rankNumber !== row.sourceRankNumber,
    );
    expect(disagreements).toEqual([]);
  });

  it("joins nearly every pub to a map pin, and never invents one", () => {
    const pinned = pack.rows.filter((row) => row.venueId);
    expect(pinned.length).toBeGreaterThan(750);
    for (const row of pinned) {
      expect(row.venueId).toMatch(/^venue-/);
      // A join is only ever made through a real measurement, so every joined
      // row carries the distance and name agreement it was made on.
      expect(row.venueMatch?.metres).toBeLessThanOrEqual(250);
    }
  });
});

describe("the value band", () => {
  const pack = loadPack();
  const modal = modalMilliunits(pack.rows);

  it("cannot be cut into terciles, which is why the modal round is the threshold", () => {
    // The measurement the module's own comment rests on: one round dominates
    // the distribution, so the first and second terciles are the same figure
    // and a tercile band would paint the commonest pub the worst colour.
    const thresholds = priceBandThresholdsFrom(
      pack.rows.map((row) => row.milliunits / 1000),
    );
    expect(thresholds).not.toBeNull();
    expect(thresholds?.cheapMaxGbp).toBe(thresholds?.averageMaxGbp);
  });

  it("takes the modal round, and every band holds real pubs", () => {
    expect(modal).not.toBeNull();
    const counts = { above: 0, typical: 0, below: 0 };
    for (const row of pack.rows) {
      const band = spoonsValueBand(row.milliunits, modal);
      expect(band).not.toBeNull();
      counts[band as keyof typeof counts] += 1;
    }
    for (const band of SPOONS_VALUE_BANDS) {
      expect(counts[band]).toBeGreaterThan(0);
    }
    // The modal band is the biggest, or it was not the modal round.
    expect(counts.typical).toBeGreaterThan(counts.above);
    expect(counts.typical).toBeGreaterThan(counts.below);
  });

  it("breaks a modal tie toward the larger round, never the meaner one", () => {
    expect(modalMilliunits([{ milliunits: 1000 }, { milliunits: 2000 }])).toBe(2000);
  });

  it("answers null for a figure it has no threshold for", () => {
    expect(spoonsValueBand(12_000, null)).toBeNull();
    expect(spoonsValueBand(null, 12_000)).toBeNull();
    expect(spoonsValueBand(0, 12_000)).toBeNull();
  });

  it("paints through the one shared band class family and nothing else", () => {
    expect(spoonsValueBandClass("above")).toBe("priceBand-cheap");
    expect(spoonsValueBandClass("typical")).toBe("priceBand-average");
    expect(spoonsValueBandClass("below")).toBe("priceBand-expensive");
    expect(spoonsValueBandClass(null)).toBe("");
  });

  it("keeps its own words, so no surface calls a units count cheap", () => {
    expect(spoonsValueBandLabel("above")).toBe("More than most");
    expect(spoonsValueBandLabel("typical")).toBe("The usual round");
    expect(spoonsValueBandLabel("below")).toBe("Less than most");
    expect(spoonsValueBandLegendLabel("typical", 12_785)).toBe("12.8");
    expect(spoonsValueBandLegendLabel("above", 12_785)).toBe("More than 12.8");
  });

  it("buckets best to worst, and gives no figure its own bucket", () => {
    expect(spoonsValueBucket("above")).toBe(0);
    expect(spoonsValueBucket("typical")).toBe(1);
    expect(spoonsValueBucket("below")).toBe(2);
    expect(spoonsValueBucket(null)).toBe(3);
  });
});

describe("what a pin says", () => {
  const lane = {
    byVenueId: new Map([
      ["venue-uk-n1", { milliunits: 15_000, pence: 995 }],
      ["venue-uk-n2", { milliunits: 12_785, pence: 995 }],
      ["venue-uk-n3", { milliunits: 5_700, pence: 999 }],
    ]),
    modalMilliunits: 12_785,
  };

  it("prints the units with their unit, never a bare number", () => {
    expect(spoonsValuePinFor(lane, "venue-uk-n1")).toEqual({
      bucket: 0,
      label: "15.0 units",
    });
    expect(spoonsValuePinFor(lane, "venue-uk-n3")).toEqual({
      bucket: 2,
      label: "5.7 units",
    });
  });

  it("says nothing at all about a pub the ranking does not hold", () => {
    expect(spoonsValuePinFor(lane, "venue-uk-nobody")).toEqual({
      bucket: 3,
      label: null,
    });
  });
});

describe("the words", () => {
  const row = {
    spoonmeId: "1",
    name: "The Test",
    town: "Testville",
    addressLine: "1 Test Street",
    postcode: "T1 1TT",
    county: "Testshire",
    country: "England",
    airport: false,
    londonZ12: false,
    milliunits: 12_785,
    pence: 995,
    drinkCount: 5,
    lines: [
      {
        name: "Stowford Press Apple cider",
        servingLabel: "Pint",
        quantity: 5,
        glasses: 5,
        linePricePence: 995,
        lineMilliunits: 12_785,
      },
    ],
    rankNumber: 42,
    sourceRankNumber: 42,
    venueId: "venue-uk-n9",
    lat: 51.5,
    lng: -0.1,
    checkedAt: "2026-08-30T19:38:37.200Z",
  } satisfies SpoonsValueRow;

  it("names the round the way somebody ordering it would", () => {
    expect(formatRoundLine(row.lines[0])).toBe("5 pints of Stowford Press Apple cider");
    expect(
      formatRoundLine({ ...row.lines[0], quantity: 1, servingLabel: "Half pint" }),
    ).toBe("1 half pint of Stowford Press Apple cider");
    expect(
      formatRoundLine({ ...row.lines[0], quantity: 2, servingLabel: "Standard" }),
    ).toBe("2 x Stowford Press Apple cider");
  });

  it("never prints a bare figure a reader could take for a pint price", () => {
    const line = bestValueRoundLine(row);
    expect(line).toBe(
      "5 pints of Stowford Press Apple cider for £9.95, 12.8 units",
    );
    expect(formatUnitsLabel(12_785)).toBe("12.8 units");
    expect(formatUnits(12_785)).toBe("12.8");
    expect(formatBasketCost(1000)).toBe("£10");
    expect(formatBasketCost(995)).toBe("£9.95");
  });

  it("opens a joined pub on the map and offers nothing for an unjoined one", () => {
    expect(spoonsValueMapHref(toTableRow(row))).toBe("/map?sel=venue-uk-n9");
    expect(spoonsValueMapHref(toTableRow({ ...row, venueId: null }))).toBeNull();
  });
});

describe("the cuts the ranking page offers", () => {
  const pack = loadPack();
  const rows = pack.rows.map(toTableRow);
  const cuts = spoonsValueCuts(rows);

  it("names only places the pack actually holds", () => {
    const countries = new Set(rows.map((row) => row.country));
    for (const cut of cuts) {
      if (!cut.id.startsWith("country:")) continue;
      expect(countries.has(cut.id.slice("country:".length))).toBe(true);
    }
  });

  it("counts every cut against the rows it really selects", () => {
    for (const cut of cuts) {
      expect(applySpoonsValueCut(rows, cut.id).length).toBe(cut.count);
    }
  });

  it("offers the airports and the London zones the report compares", () => {
    expect(cuts.some((cut) => cut.id === "airports")).toBe(true);
    expect(cuts.some((cut) => cut.id === "london-zones")).toBe(true);
  });

  it("narrows without re-ranking, so a rank always means the same thing", () => {
    const airports = applySpoonsValueCut(rows, "airports");
    expect(airports.length).toBeGreaterThan(0);
    for (const row of airports) {
      expect(row.rank).toBe(rows.find((all) => all.id === row.id)?.rank);
    }
  });
});

describe("a malformed body reads as absent, never as an empty ranking", () => {
  it("refuses a pack whose credit will not parse", () => {
    const pack = loadPack();
    expect(parseSpoonsValuePack({ ...pack, provenance: { author: "" } })).toBeNull();
  });

  it("refuses a pack with no rows rather than publishing an empty one", () => {
    const pack = loadPack();
    expect(parseSpoonsValuePack({ ...pack, rows: [] })).toBeNull();
    expect(parseSpoonsValuePack(null)).toBeNull();
    expect(parseSpoonsValuePack({})).toBeNull();
  });

  it("drops a malformed map-lane row instead of failing the lane", () => {
    expect(
      parseSpoonsValueMapLane({
        pubs: [
          ["venue-uk-n1", 12_785, 995, 1],
          ["", 1, 1, 1],
          ["venue-uk-n2", 0, 995, 1],
          "nonsense",
        ],
      }),
    ).toEqual([{ venueId: "venue-uk-n1", milliunits: 12_785, pence: 995, rankNumber: 1 }]);
    expect(parseSpoonsValueMapLane(null)).toEqual([]);
  });
});

describe("this is not a price lane, and the tree is held to it", () => {
  function walk(dir: string, out: string[]): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry.startsWith(".next")) continue;
        walk(full, out);
      } else if (/\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
  }

  // The modules that decide what a PRICE may claim. None of them may so much as
  // mention this lane: a units count read off somebody else's menu can never
  // become pin price colour, a cheapest-pint bucket, a standing or the Index.
  // Same fence lib/priceHistory.ts and lib/priceEstimate.ts already wear.
  const PRICE_AUTHORITY_MODULES = [
    "lib/priceTier.ts",
    "lib/pintTrust.ts",
    "lib/communityPrice.ts",
    "lib/venuePriceLane.ts",
    "lib/pintIndex.ts",
    "lib/pintIndexFromConfirmations.ts",
    "lib/priceBand.ts",
    "lib/ukPriceBundle.ts",
    "lib/pintDropConfirmation.ts",
  ];

  it("is named by no price-authority module", () => {
    const offenders = PRICE_AUTHORITY_MODULES.filter((file) =>
      readFileSync(join(ROOT, file), "utf8").includes("spoonsValue"),
    );
    expect(offenders).toEqual([]);
  });

  it("reaches the map through its own seam and never through the price stack", () => {
    const geojson = readFileSync(
      join(ROOT, "components", "map", "canvas", "geojson.ts"),
      "utf8",
    );
    // The lens owns the bucket and the tag when it is on, and it stamps no
    // price standing: a round somebody else costed is not a claim about a pint.
    expect(geojson).toContain("spoonsValuePinFor");
    expect(geojson).toContain("tag: { label: pin.label, standing: null }");
    // It answers FIRST and returns, so nothing below can put a price standing
    // back on a pin the lens owns.
    expect(geojson).toMatch(
      /if \(args\.spoonsValue\) \{[\s\S]{0,240}?standing: null \} \};\n *\}/,
    );
  });

  it("keeps the units figure out of every money formatter", () => {
    const files: string[] = [];
    for (const dir of ["app", "components", "lib"]) walk(join(ROOT, dir), files);
    const offenders = files
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        if (!source.includes("milliunits")) return false;
        // formatGbp is the money formatter. A units count is not money, and
        // handing one to it would print "£12.79" over a pub's own pint price.
        return /formatGbp\([^)]*milliunits/.test(source);
      })
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
