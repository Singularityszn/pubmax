import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isVenueUnpriced } from "@/lib/firstDropNudge";
import {
  PROVISIONAL_PRICE_LINE,
  venueBundlePrices,
  venuePriceLane,
  venuePriceFallbackPending,
  venuePriceLaneIsDrinkerLog,
  venuePriceLaneObservedGbp,
  venueSourcedPrice,
  type VenuePriceLane,
  type VenuePriceLaneName,
} from "@/lib/venuePriceLane";
import type { PricedVenue } from "@/lib/priceUpdates";
import type { Venue } from "@/lib/venues";

const ROOT = process.cwd();

describe("a pub's price while its reads settle", () => {
  const estimate: VenuePriceLane = {
    lane: "estimate",
    estimate: { priceGbp: 6.5, computedAt: "2026-10-06T12:00:00.000Z", basis: "regional_baseline:camden", sampleSize: 8 },
  };

  it("holds an estimate until both price reads answer", () => {
    expect(venuePriceFallbackPending(estimate, "loading", "ready")).toBe(true);
    expect(venuePriceFallbackPending(estimate, "ready", "idle")).toBe(true);
    expect(venuePriceFallbackPending(estimate, "ready", "ready")).toBe(false);
  });

  it("does not claim an empty pub before its reads answer", () => {
    expect(venuePriceFallbackPending(null, "idle", "idle")).toBe(true);
    expect(venuePriceFallbackPending(null, "ready", "ready")).toBe(false);
  });

  it("keeps an observed price during a refresh and lets failed reads settle", () => {
    expect(venuePriceFallbackPending({ lane: "contributor", contributorPrice: 4.7 }, "loading", "idle"))
      .toBe(false);
    expect(venuePriceFallbackPending(estimate, "degraded", "unavailable")).toBe(false);
  });
});

// Minimal Venue factory (same shape the other map tests use). Defaults are the
// fully-unpriced pub so each fixture overrides only the field it exercises.
function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "venue-1",
    name: "The Test Arms",
    address: "Somewhere",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "Barking and Dagenham",
    visibleBoroughs: [],
    prices: [],
    cheapestPrice: null,
    cheapestPint: "",
    averagePrice: null,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    ...overrides,
  } as Venue;
}

const SOURCED: PricedVenue["sourcedPrice"] = {
  provenance: "sourced",
  sourceLabel: "pub.example",
  sourceUrl: "https://pub.example",
  observedAt: "2026-01-01",
};

function withSourced(venue: Venue): Venue {
  (venue as PricedVenue).sourcedPrice = SOURCED;
  return venue;
}

// One fixture per branch the overview price area can take, plus the empty case
// the first-drop nudge fills. `contributor` is the price passed in beside the
// venue, exactly as the render component receives it as a prop.
const FIXTURES: ReadonlyArray<{
  name: string;
  venue: Venue;
  contributor: number | null | undefined;
  lane: VenuePriceLaneName | null;
}> = [
  {
    name: "unpriced pub — nothing on record",
    venue: makeVenue(),
    contributor: null,
    lane: null,
  },
  {
    name: "unpriced pub — contributor undefined rather than null",
    venue: makeVenue(),
    contributor: undefined,
    lane: null,
  },
  {
    name: "unpriced non-pub carrying an anchor label but no figure",
    venue: makeVenue({ kind: "restaurant", anchorLabel: "Cheapest beer" }),
    contributor: null,
    lane: null,
  },
  {
    name: "contributor price wins over everything below it",
    venue: withSourced(makeVenue({ cheapestPrice: 6.2 })),
    contributor: 5.4,
    lane: "contributor",
  },
  {
    name: "a zero contributor price is still a price",
    venue: makeVenue(),
    contributor: 0,
    lane: "contributor",
  },
  {
    name: "sourced price wins over the baseline",
    venue: withSourced(makeVenue({ cheapestPrice: 6.2 })),
    contributor: null,
    lane: "sourced",
  },
  {
    name: "sourced price with no baseline behind it",
    venue: withSourced(makeVenue()),
    contributor: null,
    lane: "sourced",
  },
  {
    name: "baseline dataset price alone",
    venue: makeVenue({ cheapestPrice: 6.2 }),
    contributor: null,
    lane: "baseline",
  },
  {
    name: "non-pub anchor claim beats the baseline wording",
    venue: makeVenue({
      kind: "restaurant",
      anchorLabel: "Cheapest beer",
      cheapestPrice: 6.2,
    }),
    contributor: null,
    lane: "anchor",
  },
  {
    name: "a pub is never an anchor, however it is labelled",
    venue: makeVenue({ anchorLabel: "Cheapest beer", cheapestPrice: 6.2 }),
    contributor: null,
    lane: "baseline",
  },
];

describe("venuePriceLane — one precedence for the overview price area", () => {
  it.each(FIXTURES)("picks the $lane lane for $name", ({ venue, contributor, lane }) => {
    const decided = venuePriceLane(venue, contributor, venueSourcedPrice(venue));
    expect(decided?.lane ?? null).toBe(lane);
  });

  it("agrees with the first-drop gate on every fixture", () => {
    // #1413: isVenueUnpriced used to restate this ordering by hand, so a lane
    // added or reordered in the render component would leave the nudge behind.
    for (const { name, venue, contributor, lane } of FIXTURES) {
      expect(isVenueUnpriced(venue, contributor), name).toBe(lane === null);
    }
  });

  it("carries the figure its branch prints, so the render re-tests nothing", () => {
    // The lane is a discriminated union rather than a bare name: the overview
    // branches used to narrow `latestContributorPrice` and `sourcedPrice`
    // themselves, which is the restated precedence this module replaces.
    const contributor = venuePriceLane(makeVenue(), 5.4, null);
    expect(contributor).toEqual({ lane: "contributor", contributorPrice: 5.4 });

    // The sourced row carries the attribution AND the figure, because a sourced
    // observation overwrites `cheapestPrice` in `mergePriceUpdates` and the
    // attribution itself holds no price a compact surface could print.
    const sourcedVenue = withSourced(makeVenue({ cheapestPrice: 5.9 }));
    expect(venuePriceLane(sourcedVenue, null, venueSourcedPrice(sourcedVenue))).toEqual({
      lane: "sourced",
      sourcedPrice: SOURCED,
      cheapestPrice: 5.9,
    });

    // A baseline nobody published: the fixture carries no price rows, so no
    // publisher, so the figure earns no listing and says so.
    expect(venuePriceLane(makeVenue({ cheapestPrice: 6.2 }), null, null)).toEqual({
      lane: "baseline",
      cheapestPrice: 6.2,
      standing: "none",
      publisher: null,
      observedOn: null,
    });

    const anchored = makeVenue({
      kind: "restaurant",
      anchorLabel: "Cheapest beer",
      cheapestPrice: 6.2,
    });
    expect(venuePriceLane(anchored, null, null)).toEqual({
      lane: "anchor",
      anchorLabel: "Cheapest beer",
      cheapestPrice: 6.2,
    });
  });

  it("covers every lane plus the empty case", () => {
    const covered = new Set(FIXTURES.map((fixture) => fixture.lane));
    expect(covered).toEqual(new Set(["anchor", "contributor", "sourced", "baseline", null]));
  });
});

// The two questions a compact surface asks about a decided lane. Both were
// added for #1426, where a phone chip and the prices-by-drink block each worded
// an absence over a drinker's own report.
describe("what a decided lane answers about itself", () => {
  const LISTED_ROW = {
    priceGbp: 5.4,
    sourceUrl: "https://thecrown.co.uk/drinks",
    observedAt: new Date(Date.now() - 86_400_000).toISOString(),
  };
  const ESTIMATE_ROW = {
    priceGbp: 6.1,
    basis: "regional_baseline:camden",
    sampleSize: 42,
    computedAt: new Date(Date.now() - 86_400_000).toISOString(),
  };
  const PROVISIONAL_ROW = { priceGbp: 4.5, observedAt: Date.now() - 86_400_000 };

  it("hands back the figure its own branch prints, for every observed lane", () => {
    const sourced = withSourced(makeVenue({ cheapestPrice: 5.9 }));
    const cases: ReadonlyArray<[VenuePriceLane, number]> = [
      [venuePriceLane(makeVenue(), 5.4, null)!, 5.4],
      [venuePriceLane(sourced, null, venueSourcedPrice(sourced))!, 5.9],
      [venuePriceLane(makeVenue(), null, null, { listed: LISTED_ROW })!, 5.4],
      [venuePriceLane(makeVenue(), null, null, {}, PROVISIONAL_ROW)!, 4.5],
      [venuePriceLane(makeVenue({ cheapestPrice: 6.2 }), null, null)!, 6.2],
      [
        venuePriceLane(
          makeVenue({ kind: "restaurant", anchorLabel: "Cheapest beer", cheapestPrice: 6.2 }),
          null,
          null,
        )!,
        6.2,
      ],
    ];
    for (const [lane, figure] of cases) {
      expect(venuePriceLaneObservedGbp(lane), lane.lane).toBe(figure);
    }
  });

  it("refuses to hand back a modelled figure, which may only print through priceStandingFigure", () => {
    const estimate = venuePriceLane(makeVenue(), null, null, { estimate: ESTIMATE_ROW })!;
    expect(estimate.lane).toBe("estimate");
    expect(venuePriceLaneObservedGbp(estimate)).toBeNull();
  });

  it("calls a lane a drinker's log only where a drinker logged it", () => {
    const sourced = withSourced(makeVenue({ cheapestPrice: 5.9 }));
    const logged: ReadonlyArray<VenuePriceLane> = [
      venuePriceLane(makeVenue(), 5.4, null)!,
      venuePriceLane(makeVenue(), null, null, {}, PROVISIONAL_ROW)!,
    ];
    const notLogged: ReadonlyArray<VenuePriceLane> = [
      venuePriceLane(sourced, null, venueSourcedPrice(sourced))!,
      venuePriceLane(makeVenue(), null, null, { listed: LISTED_ROW })!,
      venuePriceLane(makeVenue({ cheapestPrice: 6.2 }), null, null)!,
      venuePriceLane(makeVenue(), null, null, { estimate: ESTIMATE_ROW })!,
      venuePriceLane(
        makeVenue({ kind: "restaurant", anchorLabel: "Cheapest beer", cheapestPrice: 6.2 }),
        null,
        null,
      )!,
    ];
    for (const lane of logged) {
      expect(venuePriceLaneIsDrinkerLog(lane), lane.lane).toBe(true);
    }
    for (const lane of notLogged) {
      expect(venuePriceLaneIsDrinkerLog(lane), lane.lane).toBe(false);
    }
  });
});

// The two lanes the UK price bundle feeds. Their whole job is to sit in the
// right places in one order: a published figure carrying its page and its day
// beats a baseline stamp that often names no publisher, and a modelled figure
// sits below everything anybody observed.
describe("the bundle lanes", () => {
  const LISTED = {
    priceGbp: 5.4,
    sourceUrl: "https://thecrown.co.uk/drinks",
    observedAt: new Date(Date.now() - 86_400_000).toISOString(),
  };
  const ESTIMATE = {
    priceGbp: 6.1,
    basis: "regional_baseline:camden",
    sampleSize: 42,
    computedAt: new Date(Date.now() - 86_400_000).toISOString(),
  };

  it("puts a listed price above the baseline", () => {
    expect(
      venuePriceLane(makeVenue({ cheapestPrice: 6.2 }), null, null, { listed: LISTED }),
    ).toEqual({ lane: "listed", listed: LISTED });
  });

  it("keeps a live contributor price and a sourced price above it", () => {
    expect(venuePriceLane(makeVenue(), 5.9, null, { listed: LISTED })?.lane).toBe("contributor");
    const sourcedVenue = withSourced(makeVenue());
    expect(
      venuePriceLane(sourcedVenue, null, venueSourcedPrice(sourcedVenue), { listed: LISTED })?.lane,
    ).toBe("sourced");
  });

  it("puts a modelled figure below everything anybody observed", () => {
    expect(venuePriceLane(makeVenue(), null, null, { estimate: ESTIMATE })).toEqual({
      lane: "estimate",
      estimate: ESTIMATE,
    });
    expect(
      venuePriceLane(makeVenue({ cheapestPrice: 6.2 }), null, null, { estimate: ESTIMATE })?.lane,
    ).toBe("baseline");
    expect(
      venuePriceLane(makeVenue(), null, null, { listed: LISTED, estimate: ESTIMATE })?.lane,
    ).toBe("listed");
  });

  // ONE DRINKER'S REPORT SUPERSEDES A MODELLED FIGURE FOR THE SAME PUB AND DRINK.
  // Issue #1362 asked which cities may show an estimate and what corroborates
  // one, and the answer is that nothing new corroborates it: the existing Pint
  // Drop does. A lone in-window report is somebody who was actually there, so
  // it takes the area off the estimate and says what it still needs in the ONE
  // wording the lane owns. It stays below every corroborated lane, so this is a
  // swap of one unauthoritative claim for a better one, never a promotion.
  it("lets one drinker's report supersede a modelled figure, and says what it still needs", () => {
    const PROVISIONAL = { priceGbp: 4.5, observedAt: Date.now() - 86_400_000 };

    expect(
      venuePriceLane(makeVenue(), null, null, { estimate: ESTIMATE }, PROVISIONAL),
    ).toEqual({
      lane: "provisional",
      provisionalPrice: 4.5,
      observedAt: PROVISIONAL.observedAt,
    });
    expect(PROVISIONAL_PRICE_LINE).toBe("Logged once, needs a second drinker");

    // And the report has not become authoritative by displacing it: a published
    // page and a live contributor price both still outrank it.
    expect(
      venuePriceLane(makeVenue(), null, null, { listed: LISTED, estimate: ESTIMATE }, PROVISIONAL)
        ?.lane,
    ).toBe("listed");
    expect(
      venuePriceLane(makeVenue(), 5.9, null, { estimate: ESTIMATE }, PROVISIONAL)?.lane,
    ).toBe("contributor");
  });

  it("leaves a venue with nothing unpriced, and takes it off the nudge once the bundle answers", () => {
    expect(isVenueUnpriced(makeVenue(), null)).toBe(true);
    expect(isVenueUnpriced(makeVenue(), null, { estimate: ESTIMATE })).toBe(false);
  });

  it("reads an absent bundle as an empty answer rather than as no price", () => {
    // A surface that has not asked the bundle passes nothing, and the lane it
    // gets back is the one it always had.
    expect(venueBundlePrices(makeVenue())).toEqual({});
    expect(venuePriceLane(makeVenue({ cheapestPrice: 6.2 }), null, null)?.lane).toBe("baseline");
  });
});

// The lane one drinker's report earns (issue #1426). Its whole job is to sit
// between the listed row and the baseline, and to be reachable by a drop the
// corroboration gate refuses.
describe("the provisional lane", () => {
  const REPORT = { priceGbp: 4.5, observedAt: "2026-09-03T20:00:00.000Z" };
  const LISTED = {
    priceGbp: 5.4,
    sourceUrl: "https://thecrown.co.uk/drinks",
    observedAt: new Date(Date.now() - 86_400_000).toISOString(),
  };

  it("prices a pub the dataset left unpriced", () => {
    expect(venuePriceLane(makeVenue(), null, null, {}, REPORT)).toEqual({
      lane: "provisional",
      provisionalPrice: 4.5,
      observedAt: "2026-09-03T20:00:00.000Z",
    });
  });

  it("sits above the baseline and below the listed row", () => {
    expect(
      venuePriceLane(makeVenue({ cheapestPrice: 6.2 }), null, null, {}, REPORT)?.lane,
    ).toBe("provisional");
    expect(
      venuePriceLane(makeVenue(), null, null, { listed: LISTED }, REPORT)?.lane,
    ).toBe("listed");
  });

  it("keeps the corroborated contributor price and a sourced price above it", () => {
    expect(venuePriceLane(makeVenue(), 5.9, null, {}, REPORT)?.lane).toBe("contributor");
    const sourcedVenue = withSourced(makeVenue());
    expect(
      venuePriceLane(sourcedVenue, null, venueSourcedPrice(sourcedVenue), {}, REPORT)?.lane,
    ).toBe("sourced");
  });

  it("takes an epoch observedAt as readily as an ISO one", () => {
    const epoch = venuePriceLane(makeVenue(), null, null, {}, {
      priceGbp: 4.5,
      observedAt: 1_757_000_000_000,
    });
    expect(epoch?.lane).toBe("provisional");
  });

  it("refuses a report with no usable figure", () => {
    expect(
      venuePriceLane(makeVenue(), null, null, {}, {
        priceGbp: Number.NaN,
        observedAt: null,
      }),
    ).toBeNull();
  });

  it("takes the pub off the first-drop nudge", () => {
    expect(isVenueUnpriced(makeVenue(), null)).toBe(true);
    expect(isVenueUnpriced(makeVenue(), null, {}, REPORT)).toBe(false);
  });

  it("owns the one line, and nothing else writes those words", () => {
    expect(PROVISIONAL_PRICE_LINE).toBe("Logged once, needs a second drinker");
  });
});

// The other two surfaces that word a pub's missing price. Issue #1426: three
// places said "No price" over the same pub from three different tests, so the
// venue sheet could stop saying it while the others carried on.
describe("every surface that words an absent price asks the same module", () => {
  const borough = readFileSync(join(ROOT, "app/borough/[slug]/page.tsx"), "utf8");

  it("the borough list asks the lane instead of testing cheapestPrice itself", () => {
    expect(borough).toContain('from "@/lib/venuePriceLane"');
    // The wording lives in ONE cell, and that cell asks the lane. It used to
    // test `cheapestPrice` itself, so a pub priced by any other lane still
    // printed "No price" here. The borough's own cheapest-pint summary figure
    // reads `cheapestPrice` for its own reasons and is a different question.
    const cellStart = borough.indexOf("function BoroughPubPrice(");
    expect(cellStart).toBeGreaterThan(-1);
    const cell = borough.slice(cellStart, borough.indexOf("\n}", cellStart));
    expect(cell).toContain("venuePriceLane(");
    expect(borough.split('className="boroughNoPrice"').length - 1).toBe(1);
    expect(cell).toContain('className="boroughNoPrice"');
  });

  it("the unverified-pub sheet already shows an uncorroborated report, and keeps doing so", () => {
    // That sheet takes a UK base pub and a community price rather than a Venue
    // and a drop, so it cannot call this module. What it must never do is word
    // an absence over a price it is showing, which is pinned where it renders:
    // __tests__/unverifiedPubSheet.test.ts.
    const sheet = readFileSync(join(ROOT, "components/map/UnverifiedPubSheet.tsx"), "utf8");
    expect(sheet).toContain('? "Community price"');
    expect(sheet).toContain('? "No price yet"');
    expect(sheet.indexOf('? "Community price"')).toBeLessThan(
      sheet.indexOf('? "No price yet"'),
    );
  });
});

describe("VenueOverviewTab renders from the shared lane", () => {
  const overview = readFileSync(
    join(ROOT, "components/map/inspector/VenueOverviewTab.tsx"),
    "utf8",
  );

  it("branches on venuePriceLane rather than restating the precedence", () => {
    expect(overview).toContain('from "@/lib/venuePriceLane"');
    // Matched on the call's ARGUMENTS rather than one formatted line, because
    // the argument list has outgrown a single line and a reflow is not a policy
    // change. What is pinned is that the component decides nothing itself.
    // The tab takes the lane ONCE and hands it down, because the block above the
    // price area has to know whether its own absence line would stand beside a
    // figure (#1426 follow-up), and two readings of one pub could disagree.
    const call = overview.slice(overview.indexOf("const priceLane = venuePriceLane("));
    const args = call.slice(0, call.indexOf(");") + 2);
    for (const argument of [
      "venue",
      "latestContributorPrice",
      "sourcedPrice",
      "venueBundlePrices(venue)",
      "provisionalPrice",
    ]) {
      expect(args, `the lane call must be given ${argument}`).toContain(argument);
    }
    // The two bundle lanes are here for the same reason the others are: the
    // price area renders EVERY lane the precedence can answer with, so a lane
    // added in the module and missed in the component would show a pub nothing.
    for (const lane of ["anchor", "contributor", "sourced", "listed", "baseline", "estimate"]) {
      expect(overview, `price area must branch on the ${lane} lane`).toContain(
        `if (lane?.lane === "${lane}") {`,
      );
    }
    // A DRINKER'S OWN LOG TAKES ONE BRANCH (captain 7 Sept 2026). `provisional`,
    // `disputed` and `aged` are one claim said three ways, and three sibling
    // branches is how a split arrived on the Overview worded as a lone report.
    // The fence is the same promise in the new shape: every remaining lane
    // answers `venuePriceLaneIsDrinkerLog`, and that predicate is what the
    // component branches on.
    expect(overview).toContain("venuePriceLaneIsDrinkerLog(lane)");
    expect(overview).toContain("<DrinkerLogBlock");
    for (const lane of ["provisional", "disputed", "aged"] as const) {
      expect(
        venuePriceLaneIsDrinkerLog({ lane } as unknown as VenuePriceLane),
        `the ${lane} lane must render through the drinker-log block`,
      ).toBe(true);
    }
  });

  it("keeps the first-drop nudge in the branch the lane leaves empty", () => {
    const summaryStart = overview.indexOf("function VenuePriceSummary(");
    const summaryEnd = overview.indexOf("export default function VenueOverviewTab");
    expect(summaryStart).toBeGreaterThan(-1);
    expect(summaryEnd).toBeGreaterThan(summaryStart);
    const summary = overview.slice(summaryStart, summaryEnd);

    // The unpriced block is the fall-through, after the last lane branch has
    // returned. It is a block rather than the nudge itself since review finding
    // F-8: a drop read we could not RUN may not be worded as a pub with no
    // price on it, so the two absences are told apart in one place.
    const lastLaneBranch = summary.lastIndexOf('if (lane?.lane === "');
    expect(summary.indexOf("<UnpricedPubBlock")).toBeGreaterThan(lastLaneBranch);
    // And that block is the only thing that renders the nudge.
    expect(overview).toContain("<FirstDropNudge");
    const blockStart = overview.indexOf("function UnpricedPubBlock(");
    expect(blockStart).toBeGreaterThan(-1);
    const block = overview.slice(blockStart, overview.indexOf("function VenuePriceSummary("));
    expect(block).toContain("<FirstDropNudge");
    expect(block).toContain("firstDropNudgeMayClaimAbsence");

    // And the summary must not hand-roll the precedence beside the lane call.
    expect(summary).not.toMatch(
      /if \(\s*latestContributorPrice !== null && latestContributorPrice !== undefined\s*\)/,
    );
    expect(summary).not.toMatch(/if \(sourcedPrice\) \{/);

    // The branches print the figure the lane decided on, not the raw props.
    expect(summary).toContain("{formatPrice(lane.contributorPrice)}");
    expect(summary).toContain("href={lane.sourcedPrice.sourceUrl}");
  });
});
