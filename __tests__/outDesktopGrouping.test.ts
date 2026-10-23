import {
  OUT_LISTING_PUB_ABSENT_LINE,
  OUT_LISTING_VENUE_BADGE_LABEL,
  OUT_OPEN_PLANS_MIN_SENDABLE,
  groupOutListings,
  outListingPubPair,
  outListingUnmatchedCount,
  outOpenPlansSectionVisible,
  outVenueMatchNotice,
  OUT_UNMATCHED_PLACES_SHOWN,
  sendableOpenPlans,
} from "@/lib/outDesktopGrouping";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OutListingPubPair } from "@/components/out/OutListingPubPair";
import type { OutOpenPlan } from "@/lib/out";
import { describe, expect, it } from "vitest";
import type { WhatsOnRow } from "@/lib/whatsOn";

// A Sunday evening in London: the service night runs 16:00 Sun to 04:00 Mon.
const NOW = Date.parse("2026-08-16T19:00:00.000Z");

function row(partial: Partial<WhatsOnRow> & Pick<WhatsOnRow, "id" | "kind" | "title">): WhatsOnRow {
  return {
    placeName: "The Test Arms",
    source: { label: "Ticketmaster", url: "https://example.com/event/1" },
    observedAt: "2026-08-14T12:00:00.000Z",
    confidence: "listed",
    ...partial,
  };
}

function openPlan(partial: Partial<OutOpenPlan> & Pick<OutOpenPlan, "crewId" | "title">): OutOpenPlan {
  return {
    startTime: "2026-08-16T19:00:00.000Z",
    stopVenueId: "venue-1",
    stopVenueName: "The Anchor",
    hostHandle: "karan",
    memberCount: 2,
    meetingPoint: {
      kind: "venue",
      name: "The Anchor",
      lat: 51.5,
      lng: -0.1,
    },
    ...partial,
  };
}

describe("out listing grouping", () => {
  // The grouping used to key on the resolved pub and skip any row without one,
  // so a night of sourced listings at unlisted places rendered as no rows at
  // all. Nothing is dropped now: the pub is a footnote on the row.
  it("keeps every listing, matched or not", () => {
    const matched = row({
      id: "matched-product-row",
      kind: "event",
      title: "Comedy",
      venueId: "venue-123",
      startsAt: "2026-08-16T19:00:00.000Z",
    });
    const unmatched = row({
      id: "unmatched-product-row",
      kind: "event",
      title: "Arena show",
      placeName: "The O2",
      startsAt: "2026-08-16T20:00:00.000Z",
    });

    const rows = groupOutListings([unmatched, matched], NOW).flatMap((group) =>
      group.rows.map((item) => item.id),
    );
    expect(rows).toEqual(["matched-product-row", "unmatched-product-row"]);
  });

  it("counts the rows with no pub of ours without hiding them", () => {
    const padded = row({
      id: "padded-venue-row",
      kind: "event",
      title: "Comedy",
      venueId: " venue-123 ",
      startsAt: "2026-08-16T19:00:00.000Z",
    });
    const whitespaceOnly = row({
      id: "whitespace-venue-row",
      kind: "event",
      title: "Arena show",
      venueId: " \t ",
      startsAt: "2026-08-16T20:00:00.000Z",
    });

    const rows = groupOutListings([whitespaceOnly, padded], NOW).flatMap((group) =>
      group.rows.map((item) => item.id),
    );
    expect(rows).toEqual(["padded-venue-row", "whitespace-venue-row"]);
    expect(outListingPubPair(padded)).toMatchObject({ mapHref: "/map?sel=venue-123" });
    expect(outListingUnmatchedCount([padded, whitespaceOnly])).toBe(1);
  });

  it("groups by the night, in the order the nights come, earliest row first", () => {
    const early = row({
      id: "gig-a",
      kind: "music",
      title: "Early set",
      venueId: "venue-soho",
      placeName: "Soho Theatre",
      startsAt: "2026-08-16T19:00:00.000Z",
    });
    const late = row({
      id: "gig-b",
      kind: "music",
      title: "Late set",
      placeName: "Soho Theatre",
      startsAt: "2026-08-16T22:00:00.000Z",
    });
    const tomorrow = row({
      id: "quiz-1",
      kind: "quiz",
      title: "Pub quiz",
      placeName: "The Camden Head",
      startsAt: "2026-08-17T20:00:00.000Z",
    });

    const groups = groupOutListings([tomorrow, late, early], NOW);
    expect(groups.map((group) => group.label)).toEqual(["Tonight", "Tomorrow"]);
    expect(groups[0]?.rows.map((item) => item.id)).toEqual(["gig-a", "gig-b"]);
    expect(groups[1]?.rows.map((item) => item.id)).toEqual(["quiz-1"]);
  });

  it("pairs a resolved pub beside a gig and names an unresolved match without one", () => {
    const matched = row({
      id: "matched",
      kind: "event",
      title: "Comedy",
      venueId: "venue-123",
      placeName: "The Comedy Store",
    });
    const absent = row({
      id: "absent",
      kind: "event",
      title: "Arena show",
      placeName: "The O2",
    });

    expect(outListingPubPair(matched)).toEqual({
      status: "matched",
      placeName: "The Comedy Store",
      mapHref: "/map?sel=venue-123",
    });
    expect(outListingPubPair(absent)).toEqual({
      status: "absent",
      placeName: "The O2",
      line: OUT_LISTING_PUB_ABSENT_LINE,
    });
  });

  it("counts unmatched events once for the page-level state", () => {
    const matched = row({
      id: "matched-count",
      kind: "event",
      title: "Comedy",
      venueId: "venue-123",
    });
    const absent = row({ id: "absent-count", kind: "event", title: "Arena show" });

    expect(outListingUnmatchedCount([matched, absent, absent])).toBe(2);
  });

  // An unresolved match used to render nothing, which is how 148 real listings became
  // one count and an empty page. It is a line on the row now.
  it("says the pub match is unresolved on the row itself", () => {
    const html = renderToStaticMarkup(
      createElement(OutListingPubPair, {
        row: row({ id: "absent-render", kind: "event", title: "Arena show" }),
      }),
    );

    expect(html).toContain(OUT_LISTING_PUB_ABSENT_LINE);
    expect(OUT_LISTING_PUB_ABSENT_LINE).toBe("We haven’t linked this place to a pub on our map.");
  });

  it("describes an unmatched mapped venue as an unresolved match", () => {
    const listing = row({
      id: "new-cross-unmatched",
      kind: "event",
      title: "Live at New Cross Inn",
      placeName: "New Cross Inn",
    });
    expect(outListingPubPair(listing)).toMatchObject({
      status: "absent",
      line: "We haven’t linked this place to a pub on our map.",
    });
  });

  it("labels a matched event place without naming a kind", () => {
    const html = renderToStaticMarkup(
      createElement(OutListingPubPair, {
        row: row({
          id: "arena-render",
          kind: "event",
          title: "ABBA Voyage",
          placeName: "ABBA Arena",
          venueId: "venue-abba-arena",
        }),
      }),
    );

    expect(html).toContain(`>${OUT_LISTING_VENUE_BADGE_LABEL}<`);
    expect(html).not.toContain(">PUBMAXX pub<");
    expect(OUT_LISTING_VENUE_BADGE_LABEL).not.toMatch(/\bpub\b|\bvenue\b/i);
  });

  it("shows Open plans when one sendable plan exists", () => {
    const sendable = openPlan({ crewId: "crew-1", title: "Soft plan" });
    const unsendable = openPlan({
      crewId: "crew-2",
      title: "No meet point",
      meetingPoint: null,
    });

    expect(OUT_OPEN_PLANS_MIN_SENDABLE).toBe(1);
    expect(sendableOpenPlans([sendable, unsendable, sendable, sendable])).toHaveLength(3);
    expect(outOpenPlansSectionVisible([sendable, unsendable])).toBe(true);
    expect(outOpenPlansSectionVisible([unsendable])).toBe(false);
  });
});

// The page-level notice has ONE remit left. Every row prints and every row says
// its own pub answer, so a count of hidden rows would be a count of nothing.
// What a row still cannot say is that the lookup never ran.
describe("outVenueMatchNotice", () => {
  const unmatched = row({
    id: "notice-unmatched",
    kind: "event",
    title: "Arena show",
    placeName: "The O2",
  });
  const matched = row({
    id: "notice-matched",
    kind: "event",
    title: "Comedy",
    venueId: "venue-123",
    placeName: "The Comedy Store",
  });

  it("is silent whenever the match ran, however many rows it could not place", () => {
    expect(outVenueMatchNotice([unmatched, unmatched, matched], "tonight", "ready")).toBeNull();
    expect(outVenueMatchNotice([matched], "tonight", "ready")).toBeNull();
    expect(outVenueMatchNotice([], "tonight", "unavailable")).toBeNull();
  });

  it("says the check could not run rather than claiming the places are unlisted", () => {
    const notice = outVenueMatchNotice([unmatched, matched], "tonight", "unavailable");
    expect(notice?.line).toBe(
      "We couldn't check which of tonight's 1 listing is at a pub we list.",
    );
    expect(notice?.line).not.toContain("we don't list yet");
  });

  it("treats a body from before the match field as unavailable", () => {
    expect(outVenueMatchNotice([unmatched], "tonight", undefined)).not.toBeNull();
  });

  it("names the window the chip asked for and sends the other days to the map", () => {
    expect(outVenueMatchNotice([unmatched], "weekend", "unavailable")?.line).toContain(
      "this weekend's 1 listing",
    );
    expect(outVenueMatchNotice([unmatched], "weekend", "unavailable")?.way).toEqual({
      href: "/map",
      label: "Find a pub on the map",
    });
    expect(outVenueMatchNotice([unmatched], "tonight", "unavailable")?.way).toEqual({
      href: "/tonight",
      label: "See what else is on tonight",
    });
  });

  it("keeps the place names, because the check is what failed, not the places", () => {
    const notice = outVenueMatchNotice([unmatched, matched], "tonight", "unavailable");
    expect(notice?.places).toBe("The O2.");
  });

  it("uses the response's own pre-cap counts when it states them", () => {
    const notice = outVenueMatchNotice([unmatched], "tonight", "unavailable", {
      unmatchedCount: 57,
      unmatchedPlaces: ["The O2", "Alexandra Palace"],
      unmatchedPlaceCount: 40,
      unmatchedSources: ["Ticketmaster"],
    });
    expect(notice?.line).toContain("tonight's 57 listings are");
    expect(notice?.places).toBe("The O2, Alexandra Palace and 38 more places.");
    expect(notice?.credits.map((credit) => credit.label)).toEqual(["Ticketmaster"]);
  });

  it("names at most the shown number of places before it counts the rest", () => {
    const places = Array.from({ length: OUT_UNMATCHED_PLACES_SHOWN + 3 }, (_, i) => `Place ${i}`);
    const notice = outVenueMatchNotice([unmatched], "tonight", "unavailable", {
      unmatchedCount: places.length,
      unmatchedPlaces: places,
      unmatchedPlaceCount: places.length,
    });
    expect(notice?.places).toContain(`and 3 more places.`);
  });
});
