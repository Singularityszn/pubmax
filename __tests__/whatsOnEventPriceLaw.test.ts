// A kind=event row's priceGbp is a TICKET price. It prints on the /out event
// card, worded "Tickets from £X" beside its source credit, and nowhere else:
// every other What's-On lane prints a bare "£23.50", which in this product
// reads as a drink price.
//
// Each case below drives the REAL projection a surface uses, so a lane that
// started reading row.priceGbp directly again would fail here.

import { describe, expect, it } from "vitest";

import { ticketFromLine } from "@/components/out/OutCard";
import { toTonightPickDto } from "@/lib/todayBrief";
import { laneCardsFromRows } from "@/lib/whatsOnBadges";
import { whatsOnBarePriceGbp, type WhatsOnRow } from "@/lib/whatsOn";
import { buildWhatsOnAnswer } from "@/lib/concierge/whatsOn";

function row(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "row-1",
    venueId: "venue-1",
    placeName: "The Ticketed Arms",
    lat: 51.5,
    lng: -0.1,
    kind: "event",
    startsAt: "2026-08-16T19:00:00.000Z",
    title: "A Night at the Playhouse",
    priceGbp: 23.5,
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    observedAt: "2026-08-16T09:00:00.000Z",
    confidence: "listed",
    ...overrides,
  };
}

const dealRow = () =>
  row({
    id: "row-deal",
    kind: "deal",
    title: "Two for one burgers",
    endsAt: "2026-08-16T22:00:00.000Z",
    source: { label: "Wetherspoon", url: "https://www.jdwetherspoon.com/deal" },
  });

describe("whatsOnBarePriceGbp", () => {
  it("refuses an event ticket price and keeps every other kind's figure", () => {
    expect(whatsOnBarePriceGbp(row())).toBeNull();
    expect(whatsOnBarePriceGbp(dealRow())).toBe(23.5);
    expect(whatsOnBarePriceGbp(row({ kind: "quiz" }))).toBe(23.5);
    expect(whatsOnBarePriceGbp(row({ kind: "deal", priceGbp: undefined }))).toBeNull();
  });
});

describe("the lanes that project a What's-On row", () => {
  it("keeps the ticket price off the map lane card", () => {
    const cards = laneCardsFromRows([row(), dealRow()]);
    const event = cards.find((card) => card.kind === "event");
    const deal = cards.find((card) => card.kind === "deal");
    expect(event).toBeDefined();
    expect(event?.priceGbp).toBeUndefined();
    expect(deal?.priceGbp).toBe(23.5);
  });

  it("keeps the ticket price off the Today pick", () => {
    expect(toTonightPickDto(row()).priceGbp).toBeNull();
    expect(toTonightPickDto(dealRow()).priceGbp).toBe(23.5);
  });

  it("keeps the ticket price out of the Pub Pal listing answer", () => {
    const answer = buildWhatsOnAnswer({}, [row(), dealRow()]);
    const listings = answer.listings;
    expect(listings.length).toBeGreaterThan(0);
    for (const listing of listings) {
      if (listing.kind === "event") expect(listing.priceGbp).toBeUndefined();
    }
    expect(JSON.stringify(listings.filter((l) => l.kind === "event"))).not.toContain("23.5");
  });
});

describe("the out card is the one place a ticket price prints", () => {
  it("says Tickets from £X for an event and nothing for any other kind", () => {
    expect(ticketFromLine(row())).toBe("Tickets from £23.50");
    expect(ticketFromLine(row({ priceGbp: 12 }))).toBe("Tickets from £12");
    expect(ticketFromLine(dealRow())).toBeNull();
    expect(ticketFromLine(row({ priceGbp: undefined }))).toBeNull();
  });
});
