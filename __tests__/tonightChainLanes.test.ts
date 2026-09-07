import { describe, expect, it } from "vitest";

import {
  tonightChainLaneAnswers,
  tonightChainLaneOf,
  withoutTonightChainRows,
  TONIGHT_CHAIN_LANE_VISIBLE,
} from "@/lib/tonightChainLanes";
import { tonightLedeComposition, type TonightOutAnswer } from "@/lib/tonightOutListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

/**
 * The chain lanes, and the fence that keeps a chain out of the first card.
 *
 * Measured on the 7 September 2026 deploy: `/api/whats-on?window=tonight`
 * served 96 J D Wetherspoon deal rows and 24 Ticketmaster event rows, and the
 * bundled sport file carries 259 Greene King fixtures. Each of the three is
 * real supply somebody may want and none of them is a pub answering for the
 * city, so each keeps a labelled block and none may lead.
 */

const NOW = Date.parse("2026-09-07T19:00:00.000Z");
const SOON = new Date(NOW + 90 * 60_000).toISOString();
const LATER = new Date(NOW + 180 * 60_000).toISOString();
const OBSERVED = new Date(NOW - 24 * 60 * 60_000).toISOString();
const OLDER = new Date(NOW - 72 * 60 * 60_000).toISOString();

function jdwDeal(index: number): WhatsOnRow {
  return {
    id: `deal-jdw-curry-club-${index}`,
    venueId: `venue-jdw-${index}`,
    placeName: "The Moon Under Water",
    kind: "deal",
    startsAt: SOON,
    endsAt: LATER,
    title: "Curry club",
    source: {
      label: "J D Wetherspoon - Food & drink",
      url: "https://www.jdwetherspoon.com/food-drink/",
    },
    observedAt: OBSERVED,
    confidence: "listed",
  } as WhatsOnRow;
}

function ticketmasterEvent(index: number): WhatsOnRow {
  return {
    id: `event-tm-${index}`,
    venueId: `venue-tm-${index}`,
    placeName: "A big room",
    kind: "event",
    startsAt: SOON,
    title: "Arena show",
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event" },
    observedAt: OBSERVED,
    confidence: "listed",
  } as WhatsOnRow;
}

function greeneKingFixture(index: number, observedAt: string = OBSERVED): WhatsOnRow {
  return {
    id: `sport-fixture-pl2627-mw1-${index}`,
    venueId: `venue-gk-${index}`,
    placeName: "The Baron of Beef",
    kind: "sport",
    startsAt: SOON,
    title: "Arsenal v Coventry City - Premier League",
    source: { label: "Greene King", url: "https://www.greeneking.co.uk/pubs/london/baron" },
    observedAt,
    confidence: "derived",
  } as WhatsOnRow;
}

function pubRow(): WhatsOnRow {
  return {
    id: "quiz-independent-1",
    venueId: "venue-independent",
    placeName: "The Test Arms",
    kind: "quiz",
    startsAt: SOON,
    title: "Tuesday quiz",
    source: { label: "The Test Arms", url: "https://example.com/quiz" },
    observedAt: OBSERVED,
    confidence: "listed",
  } as WhatsOnRow;
}

const NO_OUT: TonightOutAnswer = {
  body: { status: "ready", listingsStatus: "ready", events: [], reason: undefined },
  failed: false,
  pending: false,
};

describe("tonight chain lanes", () => {
  it("reads the lane off the publisher, never the title", () => {
    expect(tonightChainLaneOf(jdwDeal(1))).toBe("wetherspoon");
    expect(tonightChainLaneOf(greeneKingFixture(1))).toBe("greene-king");
    expect(tonightChainLaneOf(ticketmasterEvent(1))).toBeNull();
    expect(
      tonightChainLaneOf({
        id: "quiz-1",
        source: {
          label: "The Test Arms",
          url: "https://example.com/wetherspoon-alternative",
        },
      } as WhatsOnRow),
    ).toBeNull();
  });

  it("names each block and dates it from its oldest row", () => {
    const rows = [
      pubRow(),
      jdwDeal(1),
      jdwDeal(2),
      greeneKingFixture(1),
      greeneKingFixture(2, OLDER),
    ];
    const lanes = tonightChainLaneAnswers(rows);
    expect(lanes.map((lane) => lane.title)).toEqual([
      "Wetherspoon deals tonight",
      "Greene King tonight",
    ]);
    expect(lanes[0]?.sourceLabel).toBe("J D Wetherspoon - Food & drink");
    expect(lanes[0]?.observedAt).toBe(OBSERVED);
    expect(lanes[1]?.sourceLabel).toBe("Greene King");
    expect(lanes[1]?.observedAt).toBe(OLDER);
  });

  it("leaves a block undated when one of its rows cannot be dated", () => {
    const undated = { ...jdwDeal(3), observedAt: "" } as WhatsOnRow;
    const [lane] = tonightChainLaneAnswers([jdwDeal(1), undated]);
    expect(lane?.observedAt).toBeNull();
  });

  it("gives a chain with nothing on no block at all", () => {
    expect(tonightChainLaneAnswers([pubRow()])).toEqual([]);
  });

  it("folds a block after three rows", () => {
    expect(TONIGHT_CHAIN_LANE_VISIBLE).toBe(3);
  });

  it("hands the rest of the page everything a chain did not publish", () => {
    const kept = withoutTonightChainRows([pubRow(), jdwDeal(1), greeneKingFixture(1)]);
    expect(kept.map((row) => row.id)).toEqual(["quiz-independent-1"]);
  });
});

describe("the chain fence on the lede", () => {
  const jdw = Array.from({ length: 96 }, (_, index) => jdwDeal(index));
  const ticketmaster = Array.from({ length: 24 }, (_, index) => ticketmasterEvent(index));

  it("answers empty over the 96 Wetherspoon and 24 Ticketmaster rows production serves", () => {
    const composition = tonightLedeComposition(
      [...jdw, ...ticketmaster],
      NO_OUT,
      "ready",
      NOW,
    );
    expect(composition.primaryListingRows).toEqual([]);
    expect(composition.listingsStatus).toBe("empty");
    expect(composition.listingRows.length).toBe(120);
  });

  it("keeps a Greene King fixture out of the lede and in the list below", () => {
    const rows = [greeneKingFixture(1), greeneKingFixture(2)];
    const composition = tonightLedeComposition(rows, NO_OUT, "ready", NOW);
    expect(composition.primaryListingRows).toEqual([]);
    expect(composition.listingsStatus).toBe("empty");
    expect(tonightChainLaneAnswers(composition.listingRows)).toHaveLength(1);
  });

  it("leads with the one pub when the whole chain supply rides beside it", () => {
    const composition = tonightLedeComposition(
      [...jdw, greeneKingFixture(1), pubRow(), ...ticketmaster],
      NO_OUT,
      "ready",
      NOW,
    );
    expect(composition.primaryListingRows.map((row) => row.id)).toEqual([
      "quiz-independent-1",
    ]);
    expect(composition.listingsStatus).toBe("ready");
  });

  it("refuses a chain row that arrives through the Out lane", () => {
    const composition = tonightLedeComposition(
      [pubRow()],
      {
        body: {
          status: "ready",
          listingsStatus: "ready",
          events: [greeneKingFixture(9)],
          reason: undefined,
        },
        failed: false,
        pending: false,
      },
      "ready",
      NOW,
    );
    expect(composition.outEvents).toEqual([]);
    expect(composition.primaryListingRows.map((row) => row.id)).toEqual([
      "quiz-independent-1",
    ]);
  });
});
