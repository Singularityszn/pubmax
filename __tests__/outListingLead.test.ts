// What /out leads with once it holds listings.
//
// Site audit, 13 Sep 2026 (D4): /api/out answered 25 listings, all Ticketmaster,
// the venue match RAN and placed none of them at a pub we list, and the page
// painted the first one's title ("Burlesque") as its filled primary. A night
// with nothing at a pub of ours led with a ticket sale.
//
// The law this fences: the page's primary is always a product action, never a
// listing. When the match ran, listings at a pub of ours lead; when none are,
// the honest line leads, and the rest sit under their own heading after it.

import { describe, expect, it } from "vitest";

import {
  OUT_NOT_ON_MAP_HEADING,
  OUT_TONIGHT_PUBS_WAY,
  outListingLead,
} from "@/lib/out/listingRoute";
import type { WhatsOnRow } from "@/lib/whatsOn";

function row(id: string, venueId?: string): WhatsOnRow {
  return {
    id,
    kind: "event",
    title: `Listing ${id}`,
    placeName: `Room ${id}`,
    ...(venueId ? { venueId } : {}),
    source: { label: "Ticketmaster", url: `https://www.ticketmaster.co.uk/event/${id}` },
    observedAt: "2026-09-13T12:00:00.000Z",
    confidence: "listed",
  };
}

const unmatched = Array.from({ length: 25 }, (_, index) => row(`tm-${index}`));

describe("outListingLead", () => {
  it("does not call an unmatched mapped pub absent", () => {
    const listing = { ...row("new-cross"), placeName: "New Cross Inn" };
    const lead = outListingLead([listing], "ready", "tonight");
    expect(lead.honestEmpty?.line).toBe(
      "We couldn’t match tonight’s listing to a pub on our map.",
    );
    expect(OUT_NOT_ON_MAP_HEADING).toBe("Places we couldn’t match");
  });

  it("leads with the honest line when the match ran and placed none of them", () => {
    const lead = outListingLead(unmatched, "ready", "tonight");
    expect(lead.split).toBe(true);
    expect(lead.matched).toEqual([]);
    expect(lead.unmatched).toHaveLength(25);
    expect(lead.honestEmpty).toEqual({
      line: "We couldn’t match any of tonight’s 25 listings to a pub on our map.",
      way: OUT_TONIGHT_PUBS_WAY,
    });
  });

  it("names the window and the count the reader asked for", () => {
    expect(outListingLead([row("a")], "ready", "tomorrow").honestEmpty?.line).toBe(
      "We couldn’t match tomorrow’s listing to a pub on our map.",
    );
    expect(outListingLead(unmatched.slice(0, 3), "ready", "weekend").honestEmpty?.line).toBe(
      "We couldn’t match any of this weekend’s 3 listings to a pub on our map.",
    );
  });

  it("sends only tonight's reader to tonight's pubs", () => {
    expect(outListingLead(unmatched, "ready", "tomorrow").honestEmpty?.way).toBeNull();
    expect(outListingLead(unmatched, "ready", "weekend").honestEmpty?.way).toBeNull();
    expect(OUT_TONIGHT_PUBS_WAY).toEqual({ href: "/tonight", label: "Tonight’s pubs" });
  });

  it("puts listings at a pub of ours first, in their own order, and owes no honest line", () => {
    const rows = [row("u1"), row("m1", "venue-one"), row("u2"), row("m2", "venue-two")];
    const lead = outListingLead(rows, "ready", "tonight");
    expect(lead.split).toBe(true);
    expect(lead.matched.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(lead.unmatched.map((item) => item.id)).toEqual(["u1", "u2"]);
    expect(lead.honestEmpty).toBeNull();
  });

  it("does not split or claim anything when the match did not run", () => {
    // "We couldn’t match" would be a claim about a lookup nobody performed.
    for (const venueMatch of ["unavailable", undefined] as const) {
      const lead = outListingLead(unmatched, venueMatch, "tonight");
      expect(lead.split).toBe(false);
      expect(lead.honestEmpty).toBeNull();
      expect(lead.matched).toEqual([]);
      expect(lead.unmatched).toHaveLength(25);
    }
  });

  it("owes nothing on a night with no listings, which the empty lane already answers", () => {
    const lead = outListingLead([], "ready", "tonight");
    expect(lead.honestEmpty).toBeNull();
    expect(lead.matched).toEqual([]);
    expect(lead.unmatched).toEqual([]);
  });

  it("keeps the block heading in the row's own words", () => {
    expect(OUT_NOT_ON_MAP_HEADING).toBe("Places we couldn’t match");
  });
});
