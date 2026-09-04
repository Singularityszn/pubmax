import { describe, expect, it } from "vitest";

import { orderDealsInPlace } from "@/lib/dealsHonesty";
import { groupTonightListings } from "@/lib/tonightListGrouping";
import {
  TONIGHT_QUIET_NIGHT_SENTENCE,
  tonightEmptyLead,
  tonightLedeComposition,
  tonightListingLede,
  type TonightOutAnswer,
} from "@/lib/tonightOutListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

/**
 * The Tonight lede contract.
 *
 * GrokBot verified on production that /tonight leads with a pub or with the
 * honest quiet-night sentence, after an earlier build led with a JD
 * Wetherspoon Curry Club deal. Nothing pinned it. These cases fail the moment
 * the first screen is composed from rows that include a `deal-jdw-` id, a JD
 * Wetherspoon source host, or a Ticketmaster `kind: "event"` row.
 *
 * The seam is `tonightLedeComposition`, the one call `TonightClient` makes to
 * decide what the first screen is built from (head sentence, status, cards).
 */

const NOW = Date.parse("2026-09-03T19:00:00.000Z");
const SOON = new Date(NOW + 90 * 60_000).toISOString();
const OBSERVED = new Date(NOW - 60 * 60_000).toISOString();

function row(overrides: Partial<WhatsOnRow> & Pick<WhatsOnRow, "id">): WhatsOnRow {
  return {
    venueId: "venue-independent",
    placeName: "The Test Arms",
    kind: "quiz",
    startsAt: SOON,
    title: "Listing",
    source: { label: "Pub listing", url: "https://example.com/listing" },
    observedAt: OBSERVED,
    confidence: "listed",
    ...overrides,
  } as WhatsOnRow;
}

/** A JD Wetherspoon deal by id AND by source host: both halves of the rule. */
const JDW_DEAL = row({
  id: "deal-jdw-curry-club",
  venueId: "venue-jdw",
  placeName: "The Moon Under Water",
  kind: "deal",
  title: "Curry Club",
  source: {
    label: "J D Wetherspoon deals",
    url: "https://www.jdwetherspoon.com/food-and-drink",
  },
});

/** A Ticketmaster arena row that matched a pub venue, so only kind may drop it. */
const TICKETMASTER_EVENT = row({
  id: "event-ticketmaster-playhouse",
  venueId: "venue-theatre",
  placeName: "Soho Theatre",
  kind: "event",
  title: "A Night at the Playhouse",
  source: {
    label: "Ticketmaster",
    url: "https://www.ticketmaster.co.uk/event/1",
  },
});

const PUB_QUIZ = row({
  id: "quiz-independent-1",
  venueId: "venue-independent",
  placeName: "The Test Arms",
  kind: "quiz",
  title: "Quiz night",
});

function readyOut(events: readonly WhatsOnRow[]): TonightOutAnswer {
  return {
    body: {
      status: "ready",
      listingsStatus: "ready",
      events: [...events],
      reason: undefined,
    },
    failed: false,
    pending: false,
  };
}

/** Both lanes settled: the Out lane answered and carried nothing of its own. */
const OUT_ANSWERED_EMPTY: TonightOutAnswer = readyOut([]);

/** The first card a reader meets, composed exactly as TonightClient does. */
function ledeCardTitles(rows: readonly WhatsOnRow[]): string[] {
  const groups = orderDealsInPlace(
    groupTonightListings([...rows], null, { v2: false }),
    (group) => group.row,
    null,
  );
  return groups.map((group) => group.row.title);
}

describe("tonight lede contract", () => {
  it("leads with the pub when a JDW deal and a Ticketmaster event ride the same answer", () => {
    const composition = tonightLedeComposition(
      [JDW_DEAL, TICKETMASTER_EVENT, PUB_QUIZ],
      OUT_ANSWERED_EMPTY,
      "ready",
      NOW,
    );

    expect(composition.listingsStatus).toBe("ready");
    expect(composition.primaryListingRows.map((r) => r.id)).toEqual([
      PUB_QUIZ.id,
    ]);
    expect(ledeCardTitles(composition.primaryListingRows)[0]).toBe("Quiz night");
    expect(ledeCardTitles(composition.primaryListingRows)).not.toContain(
      "Curry Club",
    );
    expect(ledeCardTitles(composition.primaryListingRows)).not.toContain(
      "A Night at the Playhouse",
    );
  });

  it("never names deals or events in the head sentence when only JDW and Ticketmaster carry them", () => {
    const composition = tonightLedeComposition(
      [JDW_DEAL, TICKETMASTER_EVENT, PUB_QUIZ],
      OUT_ANSWERED_EMPTY,
      "ready",
      NOW,
    );
    const lede = tonightListingLede(
      composition.listingsStatus,
      composition.primaryListingRows,
    );

    expect(lede).toBe(
      "Pub quizzes from sourced listings. Open a listed venue on the map.",
    );
    expect(lede).not.toContain("deals");
    expect(lede).not.toContain("events");
  });

  it("answers the honest quiet-night sentence when a JDW deal is the only listing", () => {
    const composition = tonightLedeComposition([JDW_DEAL], OUT_ANSWERED_EMPTY, "ready", NOW);

    expect(composition.primaryListingRows).toEqual([]);
    expect(composition.listingsStatus).toBe("empty");
    expect(
      tonightListingLede(
        composition.listingsStatus,
        composition.primaryListingRows,
      ),
    ).toBeNull();
    expect(tonightEmptyLead("ready", OUT_ANSWERED_EMPTY)).toBe(TONIGHT_QUIET_NIGHT_SENTENCE);
  });

  it("answers the honest quiet-night sentence when a Ticketmaster event is the only listing", () => {
    const composition = tonightLedeComposition(
      [TICKETMASTER_EVENT],
      OUT_ANSWERED_EMPTY,
      "ready",
      NOW,
    );

    expect(composition.primaryListingRows).toEqual([]);
    expect(composition.listingsStatus).toBe("empty");
  });

  it("keeps a Ticketmaster row off the lede when it arrives through the Out lane", () => {
    const composition = tonightLedeComposition(
      [PUB_QUIZ],
      readyOut([TICKETMASTER_EVENT]),
      "ready",
      NOW,
    );

    expect(composition.primaryListingRows.map((r) => r.id)).toEqual([
      PUB_QUIZ.id,
    ]);
    expect(composition.outEvents).toEqual([]);
    expect(ledeCardTitles(composition.primaryListingRows)[0]).toBe("Quiz night");
  });

  it("keeps the excluded rows available to the secondary lanes below the lede", () => {
    const composition = tonightLedeComposition(
      [JDW_DEAL, TICKETMASTER_EVENT, PUB_QUIZ],
      OUT_ANSWERED_EMPTY,
      "ready",
      NOW,
    );

    // The unfiltered list is what the Deals and Music lanes read. Dropping the
    // rows here instead of at the lede would take a real deal off the page.
    expect(composition.listingRows.map((r) => r.id)).toContain(JDW_DEAL.id);
  });
});
