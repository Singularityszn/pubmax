// The word a listing is filed under, and the night it is filed on.
//
// /out lists a whole city through a vocabulary built for a pub spine, so an
// arena musical, a warehouse rave, a stand-up night and a street-food market
// all arrive as "event". The classifier reads what the source itself published
// and answers with one of seven words; a row it cannot place honestly stays
// "other", which prints the claim the row already made.

import { describe, expect, it } from "vitest";

import {
  OUT_LISTING_KINDS,
  OUT_LISTING_KIND_LABEL,
  outListingKind,
  outListingKindLabel,
} from "@/lib/out/listingKind";
import { outListingDayGroups, outListingDayLabel } from "@/lib/out/listingDays";
import type { WhatsOnRow } from "@/lib/whatsOn";

function row(partial: Partial<WhatsOnRow> & Pick<WhatsOnRow, "id" | "title">): WhatsOnRow {
  return {
    kind: "event",
    placeName: "The Test Arms",
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    observedAt: "2026-09-07T12:00:00.000Z",
    confidence: "listed",
    ...partial,
  };
}

describe("the kind a listing is filed under", () => {
  it("reads the publisher's own genre before it reads a marketing title", () => {
    expect(
      outListingKind(row({ id: "a", title: "Saturday at the Roundhouse", detail: "Rock" })),
    ).toBe("gig");
    expect(
      outListingKind(row({ id: "b", title: "Saturday at the Roundhouse", detail: "Techno" })),
    ).toBe("club-night");
  });

  it("falls back to the title when the source published no genre", () => {
    expect(outListingKind(row({ id: "c", title: "Late night comedy club" }))).toBe("comedy");
    expect(outListingKind(row({ id: "d", title: "Borough street food market" }))).toBe("market");
    expect(outListingKind(row({ id: "e", title: "Supper club at The Eagle" }))).toBe("food");
    expect(outListingKind(row({ id: "f", title: "West End musical" }))).toBe("theatre");
  });

  it("prefers the narrower reading when two words could both match", () => {
    // Comedy Theatre is a comedy night, not a theatre listing.
    expect(outListingKind(row({ id: "g", title: "Stand-up at the Comedy Theatre" }))).toBe(
      "comedy",
    );
    // Club classics is a club night before it is a pop gig.
    expect(outListingKind(row({ id: "h", title: "Club night: pop classics" }))).toBe(
      "club-night",
    );
  });

  it("takes the row's own lane as the floor, and guesses nothing beyond it", () => {
    expect(outListingKind(row({ id: "i", kind: "music", title: "Untitled" }))).toBe("gig");
    expect(outListingKind(row({ id: "j", kind: "event", title: "Untitled" }))).toBe("other");
    // "other" prints the claim the row already made, never a made-up one.
    expect(OUT_LISTING_KIND_LABEL.other).toBe("Event");
  });

  it("spells every kind exactly once", () => {
    expect(new Set(OUT_LISTING_KINDS).size).toBe(OUT_LISTING_KINDS.length);
    const labels = OUT_LISTING_KINDS.map((kind) => OUT_LISTING_KIND_LABEL[kind]);
    expect(new Set(labels).size).toBe(labels.length);
    expect(outListingKindLabel(row({ id: "k", title: "Techno all night" }))).toBe("Club night");
  });
});

describe("the night a listing is filed on", () => {
  // A service night runs 16:00 to 04:00. 01:00 on Monday is still Sunday's.
  const sundayEvening = Date.parse("2026-09-06T19:00:00.000Z");
  const mondayEarly = Date.parse("2026-09-07T01:00:00.000Z");

  it("names the reader's own night, off the service day and not the calendar day", () => {
    expect(outListingDayLabel("2026-09-06", sundayEvening)).toBe("Tonight");
    expect(outListingDayLabel("2026-09-07", sundayEvening)).toBe("Tomorrow");
    // At 01:00 Monday the service night is STILL Sunday's, so the same date
    // keeps the same name rather than sliding a day.
    expect(outListingDayLabel("2026-09-06", mondayEarly)).toBe("Tonight");
    expect(outListingDayLabel("2026-09-07", mondayEarly)).toBe("Tomorrow");
  });

  it("names a further night by its weekday", () => {
    expect(outListingDayLabel("2026-09-12", sundayEvening)).toBe("Saturday 12 September");
  });

  it("groups the nights in order and never drops a row", () => {
    const rows = [
      row({ id: "sat", title: "Saturday gig", startsAt: "2026-09-12T20:00:00.000Z" }),
      row({ id: "sun-late", title: "Late", startsAt: "2026-09-06T23:00:00.000Z" }),
      row({ id: "sun-early", title: "Early", startsAt: "2026-09-06T19:00:00.000Z" }),
    ];
    const groups = outListingDayGroups(rows, sundayEvening);
    expect(groups.map((group) => group.label)).toEqual(["Tonight", "Saturday 12 September"]);
    expect(groups.flatMap((group) => group.rows.map((item) => item.id))).toEqual([
      "sun-early",
      "sun-late",
      "sat",
    ]);
  });

  it("keeps a row that states no date, under the window its source listed it for", () => {
    const undated = row({
      id: "undated",
      title: "Listed for the weekend",
      listedWindow: "this_weekend",
    });
    const groups = outListingDayGroups([undated], sundayEvening);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("This weekend");
    expect(groups[0]?.rows.map((item) => item.id)).toEqual(["undated"]);
  });

  it("puts the dated nights before the rows that only state a window", () => {
    const rows = [
      row({ id: "undated", title: "Listed for tonight", listedWindow: "tonight" }),
      row({ id: "dated", title: "Dated", startsAt: "2026-09-06T20:00:00.000Z" }),
    ];
    expect(outListingDayGroups(rows, sundayEvening).map((group) => group.key)).toEqual([
      "2026-09-06",
      "listed:tonight",
    ]);
  });
});
