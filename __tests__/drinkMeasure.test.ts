// The measure policy, and the promise that a half never reaches a pint lane.
//
// Contribution battle test D04. The defect had one shape and four consequences:
// a "Half of lager" at £2.60 was stored with nothing saying it was a half, so
// it corroborated, confirmed, painted a pin band and could be cited by the Pint
// Index at a pub whose pint is £5.50. Each of those is a separate lane, so each
// gets its own case here rather than one test standing in for all four.
//
// The rule the whole file exists to hold: a non-pint row is HELD OUT, never
// scaled in. Nothing in this tree may turn £2.60 for a half into £5.20 for a
// pint, and the last describe block sweeps the source for anybody trying.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  cleanDrinkMeasure,
  cleanDrinkMeasureLabel,
  DEFAULT_DRINK_MEASURE,
  drinkMeasureName,
  DRINK_MEASURES,
  measureIsPint,
  measureNamedInDrinkText,
  MEASURE_ASK_LINE,
  NON_PINT_MEASURE_PATTERNS,
  statedDrinkMeasure,
} from "@/lib/drinkMeasure";
import { validatePintDrop } from "@/lib/pintDrops";

const MEASURE_MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260905170000_0147_pint_drop_measure.sql",
);
import { pintTrustFor } from "@/lib/pintTrust";
import {
  agedPriceDrop,
  authoritativePriceDrop,
  confirmedPriceDrop,
  corroboratedPriceDrop,
  mergeVenueDrops,
  provisionalPintDropVenueIds,
  provisionalPriceDrop,
  type SummaryDrop,
  type Venue,
} from "@/lib/venues";
import {
  buildPintIndexSnapshotFromConfirmations,
  PINT_INDEX_EXCLUSION_REASONS,
} from "@/lib/pintIndexFromConfirmations";
import { readSecondReporter } from "@/lib/pintDropConfirmation";
import { defined } from "@/__tests__/helpers/defined";

const NOW = Date.parse("2026-09-05T18:00:00.000Z");
const RECENT = new Date(NOW - 60 * 60 * 1000).toISOString();
const LONG_AGO = new Date(NOW - 400 * 24 * 60 * 60 * 1000).toISOString();

function drop(over: Partial<SummaryDrop> & { priceGbp: number }): SummaryDrop {
  return {
    drink: "Lager",
    passedDownNote: "",
    provenance: "contributor",
    createdAt: RECENT,
    ...over,
  };
}

function confirmable(
  over: Partial<SummaryDrop> & { id: string; priceGbp: number },
): SummaryDrop & { id: string } {
  return { ...drop(over), id: over.id } as SummaryDrop & { id: string };
}

describe("the closed measure set", () => {
  it("is pint, half and other, and defaults to the one the lane already assumed", () => {
    expect([...DRINK_MEASURES]).toEqual(["pint", "half", "other"]);
    expect(DEFAULT_DRINK_MEASURE).toBe("pint");
  });

  it("reads an absent or unknown measure as a pint, so no legacy row changes lane", () => {
    expect(cleanDrinkMeasure(undefined)).toBe("pint");
    expect(cleanDrinkMeasure(null)).toBe("pint");
    expect(cleanDrinkMeasure("yard")).toBe("pint");
    expect(cleanDrinkMeasure("HALF")).toBe("pint");
    expect(measureIsPint(undefined)).toBe(true);
    expect(measureIsPint("half")).toBe(false);
    expect(measureIsPint("other")).toBe(false);
  });

  it("separates a STATED measure from a defaulted one", () => {
    expect(statedDrinkMeasure("half")).toBe("half");
    expect(statedDrinkMeasure(undefined)).toBe(null);
    expect(statedDrinkMeasure("yard")).toBe(null);
  });

  it("names an `other` measure by its own label, and the closed ones by their word", () => {
    expect(drinkMeasureName("pint")).toBe("Pint");
    expect(drinkMeasureName("half")).toBe("Half");
    expect(drinkMeasureName("other", "Schooner")).toBe("Schooner");
    expect(drinkMeasureName("other", "   ")).toBe("Other");
    // A label beside a measure that already names itself is ignored, never a
    // second name for one thing.
    expect(drinkMeasureName("half", "Schooner")).toBe("Half");
  });

  it("caps and cleans a free label instead of trusting it", () => {
    expect(cleanDrinkMeasureLabel("  Schooner  ")).toBe("Schooner");
    expect(cleanDrinkMeasureLabel("<script>")).toBe("script");
    expect(cleanDrinkMeasureLabel("x".repeat(90))).toHaveLength(24);
    expect(cleanDrinkMeasureLabel(42)).toBe("");
  });
});

describe("measure words in a drink text", () => {
  it("names the measure the report's own row was typed as", () => {
    expect(measureNamedInDrinkText("Half of lager")).toBe("half");
  });

  it("is word-bounded, so a pub or beer name is not a measure", () => {
    expect(measureNamedInDrinkText("Halfway House Pale")).toBe(null);
    expect(measureNamedInDrinkText("Smallbatch IPA")).toBe(null);
  });

  it("reads a measure word AS a measure, or not at all (F-22)", () => {
    // London brewery names are made of measure words, and a word boundary alone
    // refused four real pints with a sentence telling the drinker to pick the
    // measure they had already picked.
    expect(measureNamedInDrinkText("Other Half Green Diamond")).toBe(null);
    expect(measureNamedInDrinkText("Half Moon IPA")).toBe(null);
    expect(measureNamedInDrinkText("Small Beer Lager")).toBe(null);
    expect(measureNamedInDrinkText("Third Wheel Bitter")).toBe(null);
  });

  it("still reads the phrasings that really name a serving", () => {
    // Followed by a context word, or standing at the end of the text, or the
    // whole text: the three ways a measure word is used as a measure.
    expect(measureNamedInDrinkText("Half of lager")).toBe("half");
    expect(measureNamedInDrinkText("half a lager")).toBe("half");
    expect(measureNamedInDrinkText("Half pint of Guinness")).toBe("half");
    expect(measureNamedInDrinkText("2 halves of stout")).toBe("half");
    expect(measureNamedInDrinkText("Neck Oil half")).toBe("half");
    expect(measureNamedInDrinkText("half")).toBe("half");
    expect(measureNamedInDrinkText("Schooner of IPA")).toBe("other");
    expect(measureNamedInDrinkText("Third of stout")).toBe("other");
  });

  it("reads the fraction forms nobody spells out, wherever they sit", () => {
    // A fraction carries no other meaning in a drink name, so it needs no
    // context test: nobody calls a beer "1/2".
    expect(measureNamedInDrinkText("1/2 lager")).toBe("half");
    expect(measureNamedInDrinkText("lager ½")).toBe("half");
    expect(measureNamedInDrinkText("stout 2/3")).toBe("other");
  });

  it("says nothing about an ordinary pint", () => {
    expect(measureNamedInDrinkText("Pint of Guinness")).toBe(null);
    expect(measureNamedInDrinkText("")).toBe(null);
    expect(measureNamedInDrinkText(undefined)).toBe(null);
  });
});

describe("the write path", () => {
  const base = { venueId: "venue-1", handle: "alicepent", priceGbp: 2.6 };

  it("stores the measure a drinker picked", () => {
    const result = validatePintDrop({ ...base, measure: "half", drink: "Lager" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.measure).toBe("half");
  });

  it("defaults to a pint when the client says nothing", () => {
    const result = validatePintDrop({ ...base, drink: "Lager" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.measure).toBe("pint");
  });

  it("refuses the report's exact submission and asks for the measure", () => {
    const result = validatePintDrop({ ...base, drink: "Half of lager" });
    expect(result).toEqual({ ok: false, error: MEASURE_ASK_LINE });
  });

  it("accepts the same words once the drinker has said it is a half", () => {
    const result = validatePintDrop({ ...base, measure: "half", drink: "Half of lager" });
    expect(result.ok).toBe(true);
  });

  it("leaves a passed-down memory alone, because a story is not a price lane", () => {
    const result = validatePintDrop({
      venueId: "venue-1",
      handle: "alicepent",
      drink: "Halves of mild",
      passedDownNote: "Halves were 40p when the docks were open.",
    });
    expect(result.ok).toBe(true);
  });

  it("keeps a free label only on an `other` measure", () => {
    const other = validatePintDrop({
      ...base,
      measure: "other",
      measureLabel: "Schooner",
      drink: "Lager",
    });
    expect(other.ok && other.value.measureLabel).toBe("Schooner");

    const half = validatePintDrop({
      ...base,
      measure: "half",
      measureLabel: "Schooner",
      drink: "Lager",
    });
    expect(half.ok && half.value.measureLabel).toBeUndefined();
  });
});

describe("every pint lane holds a non-pint out", () => {
  const half = drop({ priceGbp: 2.6, measure: "half", authorityKey: "a" });
  const halfPeer = drop({ priceGbp: 2.6, measure: "half", authorityKey: "b" });

  it("refuses to corroborate two agreeing halves", () => {
    expect(corroboratedPriceDrop([half, halfPeer], NOW)).toBe(null);
  });

  it("refuses to read a confirmation minted over a half", () => {
    const confirmed = drop({
      priceGbp: 2.6,
      measure: "half",
      authorityKey: "a",
      confirmation: {
        confirmationId: "c1",
        confirmedAt: RECENT,
        basis: "second_reporter",
      },
    });
    expect(confirmedPriceDrop([confirmed], NOW)).toBe(null);
    expect(authoritativePriceDrop([confirmed], NOW)).toBe(null);
  });

  it("refuses to mark a pin provisionally for a half", () => {
    expect(provisionalPriceDrop([half], NOW)).toBe(null);
    expect(
      provisionalPintDropVenueIds(new Map([["venue-1", [half]]]), NOW).size,
    ).toBe(0);
  });

  it("refuses to print a half as the pub's aged pint figure", () => {
    const agedHalf = drop({ priceGbp: 2.6, measure: "half", createdAt: LONG_AGO });
    expect(agedPriceDrop([agedHalf], NOW)).toBe(null);
  });

  it("keeps a half out of the cheapest price the map reads", () => {
    const venue = {
      id: "venue-1",
      cheapestPrice: 5.5,
      cheapestPint: "Pint of Guinness",
      hasStory: false,
      prices: [],
    } as unknown as Venue;
    const merged = mergeVenueDrops([venue], new Map([["venue-1", [half, halfPeer]]]), NOW);
    expect(defined(merged[0]).cheapestPrice).toBe(5.5);
    expect(defined(merged[0]).latestContributorPrice).toBe(null);
  });

  it("reads the whole trust story as `none` over a pub whose only rows are halves", () => {
    expect(pintTrustFor([half, halfPeer], NOW).state).toBe("none");
  });

  it("still lets two agreeing PINTS corroborate, so the gate narrows nothing else", () => {
    const a = drop({ priceGbp: 5.5, authorityKey: "a" });
    const b = drop({ priceGbp: 5.5, authorityKey: "b" });
    expect(corroboratedPriceDrop([a, b], NOW)?.priceGbp).toBe(5.5);
    expect(pintTrustFor([a, b], NOW).state).toBe("corroborated");
  });
});

describe("the second-reporter pass", () => {
  it("will not pair two halves, however independent the reporters", () => {
    const reading = readSecondReporter(
      [
        confirmable({ id: "d1", priceGbp: 2.6, measure: "half", authorityKey: "a" }),
        confirmable({ id: "d2", priceGbp: 2.6, measure: "half", authorityKey: "b" }),
      ],
      NOW,
    );
    expect(reading.kind).toBe("awaiting");
  });

  it("will not let a half be the peer that confirms a pint", () => {
    const reading = readSecondReporter(
      [
        confirmable({ id: "d1", priceGbp: 2.6, authorityKey: "a" }),
        confirmable({ id: "d2", priceGbp: 2.6, measure: "half", authorityKey: "b" }),
      ],
      NOW,
    );
    expect(reading.kind).toBe("awaiting");
  });

  it("pairs two independent pints exactly as it always did", () => {
    const reading = readSecondReporter(
      [
        confirmable({ id: "d1", priceGbp: 5.5, authorityKey: "a" }),
        confirmable({ id: "d2", priceGbp: 5.5, authorityKey: "b" }),
      ],
      NOW,
    );
    expect(reading.kind).toBe("pair");
  });
});

describe("the Pint Index", () => {
  const generatedAt = new Date(NOW).toISOString();

  function build(measure: "pint" | "half") {
    return buildPintIndexSnapshotFromConfirmations({
      drops: [
        {
          id: "d1",
          venueId: "venue-1",
          priceGbp: 2.6,
          measure,
          createdAt: RECENT,
          confirmation: {
            confirmationId: "c1",
            confirmedAt: RECENT,
            basis: "second_reporter",
          },
        },
      ],
      venues: new Map([["venue-1", { name: "Arnos Arms", lat: 51.5, lng: -0.13 }]]),
      classify: () => "Westminster",
      snapshotId: "s1",
      generatedAt,
      classification: { version: "test", source: "test" } as never,
      publisher: "PUBMAXX",
      dropUrl: (id) => `https://pubmaxxing.com/drop/${id}`,
      licence: null,
    });
  }

  it("names `measure_not_pint` in its closed reason set", () => {
    expect(PINT_INDEX_EXCLUSION_REASONS).toContain("measure_not_pint");
  });

  it("counts a confirmed half out under that reason rather than citing it", () => {
    const result = build("half");
    expect(result.published).toBe(0);
    expect(
      result.snapshot.excluded.some((row) => row.reason === "measure_not_pint"),
    ).toBe(true);
  });

  it("publishes the same row when it is a pint", () => {
    expect(build("pint").published).toBe(1);
  });
});

describe("nothing in the tree scales one measure into another", () => {
  // A half is held OUT, never converted. A doubling anywhere near this
  // vocabulary would publish a figure nobody paid, so the fence reads the
  // source rather than trusting the reviewer to notice one.
  const FILES = [
    "lib/drinkMeasure.ts",
    "lib/venues.ts",
    "lib/pintDropConfirmation.ts",
    "lib/pintIndexFromConfirmations.ts",
    "lib/pintTrust.ts",
  ];

  it("has no arithmetic that turns a half price into a pint price", () => {
    for (const file of FILES) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const offenders = source
        .split("\n")
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter(({ line }) => !line.startsWith("//") && !line.startsWith("*"))
        .filter(({ line }) => /priceGbp\s*[*/]\s*2\b/.test(line));
      expect(offenders, `${file} must never scale a measure`).toEqual([]);
    }
  });

  it("holds the SQL backfill to the shared table, and to nothing of its own", () => {
    // The migration is the COPY and lib/drinkMeasure.ts is the owner, so every
    // word the backfill matches on must come off that table. A word invented
    // here would flag rows no runtime reader agrees about.
    const sql = readFileSync(MEASURE_MIGRATION, "utf8");
    const backfills = sql.match(/update public\.pint_drops[\s\S]*?;/gi) ?? [];
    expect(backfills).toHaveLength(2);

    const known = new Set<string>([
      ...DRINK_MEASURES,
      ...NON_PINT_MEASURE_PATTERNS.map((entry) => entry.word),
    ]);
    const named: string[] = [];
    for (const statement of backfills) {
      for (const quoted of statement.match(/'[^']*'/g) ?? []) {
        // Strip the bounding syntax a regex clause carries; the WORD inside it
        // is what has to be on the table.
        const word = quoted
          .slice(1, -1)
          .replace(/\\m|\\M/g, "")
          .replace(/\(\^\|\\s\)|\(\\s\|\$\)/g, "")
          .trim();
        named.push(word);
        expect(
          known.has(word),
          `migration 0147 names "${word}", which lib/drinkMeasure.ts does not`,
        ).toBe(true);
      }
    }
    // Every non-pint word the owner holds is applied by one of the two passes.
    for (const entry of NON_PINT_MEASURE_PATTERNS) {
      expect(named, `migration 0147 must flag "${entry.word}"`).toContain(entry.word);
    }
  });

  it("is pointed at by the two files that name their own fence", () => {
    // Both pointers named a test file that has never existed, so neither the
    // module nor the migration told a reader where its promise is held.
    const owner = readFileSync(join(process.cwd(), "lib/drinkMeasure.ts"), "utf8");
    const sql = readFileSync(MEASURE_MIGRATION, "utf8");
    for (const [name, source] of [["lib/drinkMeasure.ts", owner], ["migration 0147", sql]] as const) {
      expect(source, `${name} must name this file`).toContain(
        "__tests__/drinkMeasure.test.ts",
      );
    }
  });
});
