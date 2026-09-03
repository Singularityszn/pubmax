import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import TonightOnTonightSummary from "@/app/tonight/TonightOnTonightSummary";
import {
  mergeTodayListingRows,
  todayPicksReadStatus,
} from "@/lib/todayListings.server";
import { isTonightPrimaryListing, tonightPrimaryRows } from "@/lib/tonightPrimary";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { laneKindFacets } from "@/lib/whatsOnBadges";
import type { TonightOutAnswer } from "@/lib/tonightOutListings";

const listing = {
  id: "event-independent-1",
  kind: "event",
  source: {
    label: "Independent venue listing",
    url: "https://example.com/listing",
  },
} satisfies Pick<WhatsOnRow, "id" | "kind" | "source">;

const now = Date.parse("2026-09-03T18:00:00.000Z");

function fullRow(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "listing-1",
    venueId: "pub-1",
    placeName: "Test pub",
    kind: "deal",
    startsAt: "2026-09-03T19:00:00.000Z",
    title: "Test listing",
    source: {
      label: "Independent venue listing",
      url: "https://example.com/listing",
    },
    observedAt: "2026-09-03T17:00:00.000Z",
    confidence: "listed",
    ...overrides,
  };
}

function readyOut(events: WhatsOnRow[]): TonightOutAnswer {
  return {
    body: {
      status: "ready",
      listingsStatus: "ready",
      events,
      reason: undefined,
    },
    failed: false,
    pending: false,
  };
}

describe("tonight primary listing selection", () => {
  it("excludes event rows from primary surfaces", () => {
    expect(isTonightPrimaryListing(listing)).toBe(false);
  });

  it("excludes Ticketmaster rows by source metadata", () => {
    expect(
      isTonightPrimaryListing({
        ...listing,
        id: "quiz-ticketmaster-1",
        kind: "quiz",
        source: {
          label: "Ticketmaster",
          url: "https://www.ticketmaster.co.uk/listing",
        },
      }),
    ).toBe(false);
  });

  it("excludes JD Wetherspoon deals by source metadata", () => {
    expect(
      isTonightPrimaryListing({
        ...listing,
        id: "deal-independent-1",
        kind: "deal",
        source: {
          label: "J D Wetherspoon deals",
          url: "https://www.jdwetherspoon.com/food-and-drink",
        },
      }),
    ).toBe(false);
  });

  it("excludes every row whose source host is JD Wetherspoon", () => {
    expect(
      isTonightPrimaryListing({
        ...listing,
        id: "quiz-independent-1",
        kind: "quiz",
        source: {
          label: "J D Wetherspoon pub calendar",
          url: "https://www.jdwetherspoon.com/food-and-drink",
        },
      }),
    ).toBe(false);
  });

  it("does not classify a source from path text on another host", () => {
    expect(
      isTonightPrimaryListing({
        ...listing,
        id: "quiz-independent-1",
        kind: "quiz",
        source: {
          label: "Independent pub listing",
          url: "https://example.com/reviews/jdwetherspoon-alternative",
        },
      }),
    ).toBe(true);
  });

  it("uses the JD Wetherspoon deal id without matching title text", () => {
    expect(
      isTonightPrimaryListing({
        ...listing,
        id: "deal-jdw-123",
        kind: "deal",
      }),
    ).toBe(false);

    const independentDeal = {
      ...listing,
      id: "deal-independent-curry-club",
      kind: "deal" as const,
      title: "JD Wetherspoon Curry Club wording from another source",
    };

    expect(isTonightPrimaryListing(independentDeal)).toBe(true);
  });

  it("keeps primary rows in source order", () => {
    const rows = [
      { ...listing, id: "event-1" },
      { ...listing, id: "deal-independent-1", kind: "deal" as const },
      { ...listing, id: "deal-jdw-1", kind: "deal" as const },
    ];

    expect(tonightPrimaryRows(rows).map((row) => row.id)).toEqual([
      "deal-independent-1",
    ]);
  });

  it("keeps excluded rows out of Today picks and status", () => {
    const ticketmasterEvent = fullRow({
      id: "event-ticketmaster-1",
      kind: "event",
      source: {
        label: "Ticketmaster",
        url: "https://www.ticketmaster.co.uk/listing",
      },
    });
    const out = readyOut([ticketmasterEvent]);

    expect(mergeTodayListingRows([ticketmasterEvent], out, now, "ready")).toEqual([]);
    expect(todayPicksReadStatus("ready", 1, out, now, [ticketmasterEvent])).toBe("ready");
  });

  it("keeps unmatched independent listings out of Today picks", () => {
    const unmatchedDeal = fullRow({
      id: "deal-independent-unmatched",
      venueId: undefined,
      placeName: "A place outside the listed pub index",
    });

    expect(
      mergeTodayListingRows([unmatchedDeal], readyOut([]), now, "ready"),
    ).toEqual([]);
  });

  it("keeps excluded rows out of the On tonight summary", () => {
    const primaryDeal = fullRow({
      id: "deal-independent-1",
      title: "Independent pub deal",
    });
    const ticketmasterEvent = fullRow({
      id: "event-ticketmaster-1",
      kind: "event",
      title: "Arena show from Ticketmaster",
      source: {
        label: "Ticketmaster",
        url: "https://www.ticketmaster.co.uk/listing",
      },
    });

    const summary = renderToStaticMarkup(
      createElement(TonightOnTonightSummary, {
        facets: laneKindFacets([primaryDeal, ticketmasterEvent]),
        rows: [ticketmasterEvent, primaryDeal],
        totalCount: 2,
        now,
      }),
    );

    expect(summary).toContain("1 listing");
    expect(summary).toContain("Independent pub deal");
    expect(summary).not.toContain("Arena show from Ticketmaster");
    expect(summary).not.toContain("listed night");
  });
});
