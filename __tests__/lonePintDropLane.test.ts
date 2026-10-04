// A lone public Pint Drop, end to end (issue #1426).
//
// Production showed the venue Overview saying "No price yet" over The Sir
// Christopher Hatton while its Drinks tab held a public £4.50 Lager logged by
// handle `tester`. Three seams kept that drop off the price area: corroboration
// needs two in-window drops, each needs a non-null authority key and that row
// has none, and `/api/venue/[id]` never merges drops at all.
//
// The fix leaves all three alone. The corroboration gate still owns pin colour,
// cheapest buckets and the Pint Index; a fifth `provisional` lane shows the
// figure the drinker logged, dated, with the one line saying what it lacks.
//
// These cases run the pipeline in the order PubMap runs it: drops fold into the
// signal through `provisionalPriceDrop`, and the overview tab renders the lane.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { firstDropNudgeCopy } from "@/lib/firstDropNudge";
import {
  BASELINE_NO_PUBLISHER_CAPTION,
  baselineTrustCaption,
} from "@/lib/venuePriceLane";
import { drinkLensEmptyVenueNote } from "@/lib/mapExperienceLens";
import { drinkLaneLogActionLabel, drinkLaneLogInvite } from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";
import {
  confirmPintActionLabel,
  confirmPintActionName,
} from "@/lib/pintDropSecondDrinker";
import { peekPriceChip } from "@/lib/pubMap";
import {
  AGED_PRICE_LINE,
  PROVISIONAL_PRICE_LINE,
  venuePriceLane,
  venueBundlePrices,
  venueSourcedPrice,
} from "@/lib/venuePriceLane";
import {
  agedPriceDrop,
  corroboratedPriceDrop,
  mergeVenueDrops,
  provisionalPriceDrop,
  type SummaryDrop,
  type Venue,
} from "@/lib/venues";
import { pintTrustFor } from "@/lib/pintTrust";
import { defined } from "@/__tests__/helpers/defined";

vi.mock("@/components/visits/VisitReportPanel", () => ({
  default: () => createElement("div", { "data-testid": "visit-report-peek" }),
}));

// The freshness label reads the wall clock, so the day the sheet prints is
// pinned rather than left to drift with the run.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

const noop = () => {};
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-04T20:00:00.000Z");
const YESTERDAY = new Date(NOW - DAY_MS).toISOString();
const VENUE_ID = "venue-1vle947";

function venue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: VENUE_ID,
    name: "The Sir Christopher Hatton",
    address: "4 Leather Lane",
    latitude: 51.52,
    longitude: -0.11,
    primaryBorough: "Camden",
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
    kind: "pub",
    ...overrides,
  } as Venue;
}

// The production row: a public drop by a handle with NO authority key, because
// it came through the unlinked-handle door.
function drop(overrides: Partial<SummaryDrop> = {}): SummaryDrop {
  return {
    drink: "Lager",
    priceGbp: 4.5,
    passedDownNote: "",
    provenance: "contributor",
    createdAt: YESTERDAY,
    handle: "tester",
    ...overrides,
  };
}

function communityPrices(venueId: string): CommunityPricesState {
  return {
    byVenueId: new Map([[venueId, []]]),
    signalsByVenueId: new Map(),
    freshestByVenueId: new Map(),
    noAlcoholIndexStatus: "idle",
    loadNoAlcoholIndex: noop,
    loadDrinkCategoryIndex: noop,
    drinkCategoryIndexStatus: new Map(),
    provisionalBaseVenueIds: new Set(),
    loadProvisionalBaseVenues: noop,
    loadVenue: noop,
    venuePriceStatus: new Map([[venueId, "ready"]]),
    submit: async () => ({ ok: true, attribution: { status: "anonymous" }, price: null }),
    submitVenueSignal: async () => ({ ok: true }),
    submitting: false,
    reportPrice: noop,
    reportedIds: new Set(),
  } as unknown as CommunityPricesState;
}

/** The whole path a selected venue takes, exactly as PubMap wires it. */
function renderSelectedVenue(
  drops: SummaryDrop[],
  base: Venue = venue(),
  drinkLensCategory: DrinkCategory | null = null,
  onConfirmPrice?: (priceGbp: number) => void,
): string {
  const [merged] = mergeVenueDrops([base], new Map([[VENUE_ID, drops]]), NOW);
  const corroborated = corroboratedPriceDrop(drops, NOW);
  const provisional = provisionalPriceDrop(drops, NOW);
  const aged = agedPriceDrop(drops, NOW);
  return renderToStaticMarkup(
    createElement(VenueOverviewTab, {
      venue: defined(merged),
      tab: "overview",
      cityId: "london",
      mode: "suggest",
      inCrawl: false,
      latestContributorPrice: corroborated?.priceGbp ?? null,
      provisionalPrice: provisional
        ? {
            priceGbp: provisional.priceGbp as number,
            observedAt: Date.parse(provisional.createdAt),
          }
        : null,
      agedPrice: aged
        ? { priceGbp: aged.priceGbp as number, observedAt: Date.parse(aged.createdAt) }
        : null,
      communityPrices: communityPrices(VENUE_ID),
      experienceLens: "all",
      drinkLensCategory,
      onToggleStop: noop,
      presenceState: "idle",
      markPresenceHere: noop,
      userLocation: null,
      locationRequestStatus: "idle",
      onRequestLocation: noop,
      onClearLocation: noop,
      onLogTonightPrice: noop,
      onConfirmPrice,
      onOpenVisitReports: noop,
      priceEntryAllowed: false,
      priceSignInRequested: false,
      priceAuthLoading: false,
      priceFocusRequest: 0,
    }),
  );
}

describe("the second drinker's door on a logged-once price", () => {
  it("offers the one action, worded over the figure the lane prints", () => {
    const html = renderSelectedVenue([drop()], venue(), null, noop);
    expect(html).toContain('data-testid="confirm-pint-cta"');
    expect(html).toContain(confirmPintActionLabel(4.5));
    expect(html).toContain(
      confirmPintActionName(4.5, "The Sir Christopher Hatton"),
    );
  });

  it("is offered on an aged-out report too, over the aged figure", () => {
    // AGED_PRICE_LINE asks for a fresh drinker, and the door is how one
    // arrives. Read off the same trust state the chip carries.
    const html = renderSelectedVenue(
      [drop({ createdAt: new Date(NOW - 90 * DAY_MS).toISOString() })],
      venue(),
      null,
      noop,
    );
    expect(html).toContain('data-pint-trust="aged-out"');
    expect(html).toContain('data-testid="confirm-pint-cta"');
    expect(html).toContain(confirmPintActionLabel(4.5));
  });

  it("is absent where the map already holds the pub's price", () => {
    const html = renderSelectedVenue(
      [drop({ authorityKey: "key-a" }), drop({ authorityKey: "key-b" })],
      venue(),
      null,
      noop,
    );
    expect(html).not.toContain('data-testid="confirm-pint-cta"');
  });

  it("is absent when the sheet was handed no door", () => {
    expect(renderSelectedVenue([drop()])).not.toContain('data-testid="confirm-pint-cta"');
  });
});

describe("a lone public Pint Drop on the venue Overview", () => {
  it("prints the drinker's figure instead of the first-drop nudge", () => {
    const html = renderSelectedVenue([drop()]);
    expect(html).toContain("£4.50");
    expect(html).not.toContain(firstDropNudgeCopy(VENUE_ID).line);
  });

  it("says what it still needs, in the one wording the lane owns", () => {
    expect(renderSelectedVenue([drop()])).toContain(PROVISIONAL_PRICE_LINE);
  });

  it("dates the report, because a price with no day is not evidence", () => {
    expect(renderSelectedVenue([drop()])).toContain("logged 1 day ago");
  });

  it("wears no trust pill: `listed` means published with a page, and this is not", () => {
    const html = renderSelectedVenue([drop()]);
    expect(html).not.toContain("trustPill");
    expect(html).not.toContain("data-standing=");
  });

  it("shows over a pub the curated dataset already priced, above the baseline", () => {
    const html = renderSelectedVenue([drop()], venue({ cheapestPrice: 6.2 }));
    expect(html).toContain("£4.50");
    expect(html).toContain(PROVISIONAL_PRICE_LINE);
    expect(html).not.toContain("Baseline on record");
  });

  it("two drops from ONE drinker stay provisional, because that is still one report", () => {
    const drops = [
      drop({ priceGbp: 4.5, handle: "tester", authorityKey: "account-tester" }),
      drop({
        priceGbp: 4.6,
        handle: "tester",
        authorityKey: "account-tester",
        createdAt: new Date(NOW - 2 * DAY_MS).toISOString(),
      }),
    ];
    expect(corroboratedPriceDrop(drops, NOW)).toBeNull();
    expect(renderSelectedVenue(drops)).toContain(PROVISIONAL_PRICE_LINE);
  });

  it("two independent drinkers take the contributor lane and drop the line", () => {
    const drops = [
      drop({ priceGbp: 4.5, handle: "tester", authorityKey: "account-tester" }),
      drop({
        priceGbp: 4.5,
        handle: "second_drinker",
        authorityKey: "account-second",
        createdAt: new Date(NOW - 2 * DAY_MS).toISOString(),
      }),
    ];
    const html = renderSelectedVenue(drops);
    expect(html).toContain("Latest Pint Drop price");
    expect(html).toContain("£4.50");
    expect(html).not.toContain(PROVISIONAL_PRICE_LINE);
  });

  it("an aged-out report keeps its figure, dated, and says what it lacks", () => {
    // Captain's cut 5 Sept 2026: the drop list below still prints this drop,
    // so the price area may not invite a FIRST drop over it. It prints the
    // figure with its age and the one aged line (lib/venuePriceLane.ts).
    const html = renderSelectedVenue([
      drop({ createdAt: new Date(NOW - 90 * DAY_MS).toISOString() }),
    ]);
    expect(html).toContain("£4.50");
    expect(html).toContain("logged 90 days ago");
    expect(html).toContain(AGED_PRICE_LINE);
    expect(html).not.toContain(PROVISIONAL_PRICE_LINE);
    expect(html).not.toContain(firstDropNudgeCopy(VENUE_ID).line);
    expect(html).toContain('data-pint-trust="aged-out"');
  });

  it("never moves the map: the projection and the corroboration gate are untouched", () => {
    const [merged] = mergeVenueDrops([venue()], new Map([[VENUE_ID, [drop()]]]), NOW);
    expect(defined(merged).cheapestPrice).toBeNull();
    expect(defined(merged).latestContributorPrice).toBeNull();
    expect(corroboratedPriceDrop([drop()], NOW)).toBeNull();
  });
});

// The two surfaces the first cut of this lane missed (#1426 follow-up). The cases above
// render the Overview's price AREA; the reds were the block ABOVE it and the
// chip a phone shows over the sheet, and neither was rendered here.
//
// Both now ask the same `venuePriceLane`, so what a reader may be told is
// absent is decided in one place for the whole pub.

/** The exact absence wording the prices-by-drink block owns, in beer. */
const BEER_ABSENCE_NOTE = drinkLensEmptyVenueNote("beer", "ready");
const BEER_LOG_INVITE = drinkLaneLogInvite("beer", "ready") as string;

describe("the prices-by-drink block over a lone Pint Drop", () => {
  it("says nothing is logged here only when nothing is", () => {
    expect(renderSelectedVenue([])).toContain(BEER_ABSENCE_NOTE);
  });

  it("holds that line over a drinker's own report, which IS a log", () => {
    const html = renderSelectedVenue([drop()]);
    expect(html).not.toContain(BEER_ABSENCE_NOTE);
    expect(html).not.toContain(BEER_LOG_INVITE);
    expect(html).not.toContain(drinkLaneLogActionLabel("beer"));
  });

  it("prints the figure ONCE: the block above never repeats the lane's own", () => {
    expect(renderSelectedVenue([drop()]).split("£4.50").length - 1).toBe(1);
  });

  it("words no absence anywhere in the sheet while the lane answers", () => {
    const html = renderSelectedVenue([drop()]);
    for (const absence of [
      BEER_ABSENCE_NOTE,
      "No price yet",
      "no beer price logged",
      firstDropNudgeCopy(VENUE_ID).line,
    ]) {
      expect(html, absence).not.toContain(absence);
    }
  });

  it("returns the wording when the drop is gone", () => {
    const html = renderSelectedVenue([]);
    expect(html).toContain(BEER_ABSENCE_NOTE);
    expect(html).toContain(firstDropNudgeCopy(VENUE_ID).line);
  });

  it("holds the wording over an aged report too, which is still a log", () => {
    const html = renderSelectedVenue([
      drop({ createdAt: new Date(NOW - 90 * DAY_MS).toISOString() }),
    ]);
    expect(html).not.toContain(BEER_ABSENCE_NOTE);
    expect(html).not.toContain("No price yet");
  });

  it("still says so for a drink the report is not about", () => {
    // A pint report answers nothing about coffee, so the coffee lane keeps its
    // own honest absence.
    const html = renderSelectedVenue([drop()], venue(), "coffee");
    expect(html).toContain(drinkLensEmptyVenueNote("coffee", "ready"));
  });
});

/** The peek's own lane input, exactly as PubMap builds it from the drop signal. */
function peekChipFor(drops: SummaryDrop[], base: Venue = venue()) {
  const [merged] = mergeVenueDrops([base], new Map([[VENUE_ID, drops]]), NOW);
  const provisional = provisionalPriceDrop(drops, NOW);
  const aged = agedPriceDrop(drops, NOW);
  const bundle = venueBundlePrices(defined(merged));
  return peekPriceChip(
    venuePriceLane(
      defined(merged),
      corroboratedPriceDrop(drops, NOW)?.priceGbp ?? null,
      venueSourcedPrice(defined(merged)),
      bundle,
      provisional
        ? {
            priceGbp: provisional.priceGbp as number,
            observedAt: Date.parse(provisional.createdAt),
          }
        : null,
      aged
        ? { priceGbp: aged.priceGbp as number, observedAt: Date.parse(aged.createdAt) }
        : null,
    ),
    bundle,
    pintTrustFor(drops, NOW).state,
  );
}

describe("the phone peek chip over a lone Pint Drop", () => {
  it("prints the drinker's figure rather than an absence", () => {
    expect(peekChipFor([drop()])).toEqual({
      figure: "£4.50",
      priceGbp: 4.5,
      caption: PROVISIONAL_PRICE_LINE,
      observed: true,
      trust: "logged-once",
    });
  });

  it("answers null only when the pub has no price at all, which is the ONE branch that may say so", () => {
    expect(peekChipFor([])).toBeNull();
    // An aged report is still a visible public drop, so the chip keeps it.
    expect(
      peekChipFor([drop({ createdAt: new Date(NOW - 90 * DAY_MS).toISOString() })]),
    ).toEqual({
      figure: "£4.50",
      priceGbp: 4.5,
      caption: AGED_PRICE_LINE,
      observed: true,
      trust: "aged-out",
    });
  });

  const PUBLISHER = {
    label: "Pint Prices",
    url: "https://www.pint-prices.com/pub/the-sir-christopher-hatton",
  };

  it("keeps the baseline chip it always printed, in the reader's word", () => {
    // Captain 6 Sep 2026, reading the sheet head: under the price it said
    // "baseline on record", which is our word and not the reader's. It means
    // the LISTED price we hold, so it says what the rest of the product says.
    const published = venue({
      cheapestPrice: 6.2,
      prices: [
        {
          app_price_id: "app_price_1",
          pint_name: "Pravha",
          price_gbp: 6.2,
          pub_url: "https://www.pint-prices.com/pub/the-sir-christopher-hatton",
          scraped_at_values: "2026-09-04T11:15:56Z",
        },
      ] as Venue["prices"],
    });
    const chip = peekChipFor([], published);
    expect(chip).toEqual({
      figure: "£6.20",
      priceGbp: 6.2,
      caption: baselineTrustCaption({
        standing: "listed",
        publisher: PUBLISHER,
        observedOn: "2026-09-04",
      }),
      observed: true,
      trust: null,
    });
    expect(chip?.caption).toBe("Listed · collected 4 Sept");
    expect(chip?.caption).not.toMatch(/baseline/i);
  });

  it("cannot claim a listing for a price nobody published", () => {
    // The fixture carries no price rows, so no publisher, so no listing. The
    // chip says what it really is rather than borrowing the word.
    const chip = peekChipFor([], venue({ cheapestPrice: 6.2 }));
    expect(chip?.caption).toBe(BASELINE_NO_PUBLISHER_CAPTION);
    expect(chip?.caption).not.toMatch(/listed/i);
  });

  it("gives the sheet head and the Overview ONE word for one pub", () => {
    // Battle test M05: the peek and the Overview may not read one pub two
    // ways, so both take the caption from the lane rather than each naming it.
    const published = venue({
      cheapestPrice: 6.2,
      prices: [
        {
          app_price_id: "app_price_1",
          pint_name: "Pravha",
          price_gbp: 6.2,
          pub_url: "https://www.pint-prices.com/pub/the-sir-christopher-hatton",
        },
      ] as Venue["prices"],
    });
    const caption = peekChipFor([], published)?.caption ?? "";
    const html = renderSelectedVenue([], published);
    expect(caption).not.toBe("");
    expect(html).toContain(caption);
    expect(html).not.toContain("Baseline on record");
  });

  it("is the ONLY thing the peek words as an absence", () => {
    const source = readFileSync(
      join(process.cwd(), "components/PubMap.tsx"),
      "utf8",
    );
    // The chip decides first, and the "No price yet" button is reachable only
    // where it answered null.
    expect(source).toContain(
      "const peekPrice = peekPriceChip(peekLane, peekBundle, peekDropSignal?.pintTrust ?? null);",
    );
    expect(source).toMatch(
      /\) : peekPrice \? \([\s\S]*?\) : selectedVenueIsPub \? \([\s\S]*?No price yet\./,
    );
  });
});
