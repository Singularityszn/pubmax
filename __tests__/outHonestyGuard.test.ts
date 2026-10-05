// P1 guard — Out honesty (ClaudeFix, 1 Oct 2026).
//
// ON PUBMAXX only for rows with a confirmed pub match. Everything else sits under
// "Places we couldn't match" with the row line "We haven't linked this place to a
// pub on our map." No global empty-night banner when matched cards exist. Unmatched
// listings never become Tonight map pins or /out map deep-links.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OutListingPubPair } from "@/components/out/OutListingPubPair";
import {
  OUT_LISTING_PUB_ABSENT_LINE,
  OUT_LISTING_VENUE_BADGE_LABEL,
  outListingPubPair,
  outVenueMatchNotice,
} from "@/lib/outDesktopGrouping";
import { outListingLead, outListingRoute } from "@/lib/out/listingRoute";
import {
  attachOutVenues,
  buildOutVenueMatchIndex,
  matchOutRowVenue,
} from "@/lib/out/venueMatch";
import {
  mergeTonightListingRows,
  tonightRowHasListedPub,
} from "@/lib/tonightOutListings";
import type { VenueRef } from "@/lib/venueIndex";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { defined } from "@/__tests__/helpers/defined";

const ABBA_ARENA: VenueRef = {
  id: "venue-16cduf6",
  name: "ABBA Arena",
  borough: "Newham",
  lat: 51.5331758,
  lng: -0.0131831,
};

const NEW_CROSS_INN_LONDON: VenueRef = {
  id: "venue-6tjmcd",
  name: "New Cross Inn",
  borough: "Lewisham",
  lat: 51.475767295,
  lng: -0.037148763,
};

const LEXINGTON: VenueRef = {
  id: "venue-1137z1c",
  name: "The Lexington",
  borough: "Islington",
  lat: 51.5326,
  lng: -0.1119,
};

const SLIM_INDEX = buildOutVenueMatchIndex([ABBA_ARENA, NEW_CROSS_INN_LONDON, LEXINGTON]);

const NOW = Date.parse("2026-10-01T17:00:00.000Z");
const TONIGHT_START = new Date(NOW + 2 * 60 * 60_000).toISOString();

function ticketRow(
  partial: Partial<WhatsOnRow> & Pick<WhatsOnRow, "id" | "title" | "placeName">,
): WhatsOnRow {
  return {
    kind: "event",
    startsAt: TONIGHT_START,
    source: {
      label: "Ticketmaster",
      url: "https://www.ticketmaster.co.uk/event/example",
    },
    observedAt: "2026-10-01T09:00:00.000Z",
    confidence: "listed",
    sourceId: partial.id,
    ...partial,
  };
}

const SIX_VAUDEVILLE = ticketRow({
  id: "events-tm-six-vaudeville",
  title: "SIX",
  placeName: "Vaudeville Theatre",
  lat: 51.5112,
  lng: -0.1223,
});

const NEW_CROSS_WREX = ticketRow({
  id: "events-tm-new-cross-wrex",
  title: "Live at New Cross Inn",
  placeName: "New Cross Inn",
  lat: 53.0465,
  lng: -2.9935,
});

const ABBA_VOYAGE = ticketRow({
  id: "events-tm-abba-voyage",
  title: "ABBA Voyage",
  placeName: "ABBA Arena",
  lat: ABBA_ARENA.lat,
  lng: ABBA_ARENA.lng,
});

describe("out honesty guard — request-time matching", () => {
  it("keeps SIX at the Vaudeville Theatre unmatched", () => {
    expect(matchOutRowVenue(SIX_VAUDEVILLE, SLIM_INDEX)).toBeNull();
    const attached = attachOutVenues([SIX_VAUDEVILLE], SLIM_INDEX);
    expect(defined(attached.rows[0]).venueId).toBeUndefined();
    expect(attached.unmatched).toBe(1);
  });

  it("keeps New Cross Inn (Wrex) unmatched until a real London pub match exists", () => {
    expect(matchOutRowVenue(NEW_CROSS_WREX, SLIM_INDEX)).toBeNull();
    const attached = attachOutVenues([NEW_CROSS_WREX], SLIM_INDEX);
    expect(defined(attached.rows[0]).venueId).toBeUndefined();
  });

  it("only attaches ABBA Arena when the place name and coordinates confirm the pin", () => {
    expect(matchOutRowVenue(ABBA_VOYAGE, SLIM_INDEX)).toBe("venue-16cduf6");
    const wrongCoords = { ...ABBA_VOYAGE, lat: 51.5, lng: 0 };
    expect(matchOutRowVenue(wrongCoords, SLIM_INDEX)).toBeNull();
  });
});

describe("out honesty guard — /out lead and wording", () => {
  it("does not show the all-unmatched banner when matched ON PUBMAXX cards exist", () => {
    const lexington = ticketRow({
      id: "events-tm-lex",
      title: "Live band night",
      placeName: "The Lexington",
      lat: LEXINGTON.lat,
      lng: LEXINGTON.lng,
    });
    const attached = attachOutVenues([lexington, SIX_VAUDEVILLE, NEW_CROSS_WREX], SLIM_INDEX);
    const rows = attached.rows;
    const lead = outListingLead(rows, "ready", "tonight");
    expect(lead.honestEmpty).toBeNull();
    expect(lead.matched).toHaveLength(1);
    expect(defined(lead.matched[0]).id).toBe("events-tm-lex");
    expect(lead.unmatched.map((row) => row.id)).toEqual([
      "events-tm-six-vaudeville",
      "events-tm-new-cross-wrex",
    ]);
    expect(
      outVenueMatchNotice(rows, "tonight", "ready", {
        unmatchedCount: attached.unmatched,
      }),
    ).toBeNull();
  });

  it("renders On PUBMAXX only on confirmed matches and the absent line on theatres", () => {
    const matched = attachOutVenues([ABBA_VOYAGE], SLIM_INDEX).rows[0];
    const matchedHtml = renderToStaticMarkup(
      createElement(OutListingPubPair, { row: defined(matched) }),
    );
    expect(matchedHtml).toContain(OUT_LISTING_VENUE_BADGE_LABEL);
    expect(matchedHtml).toContain("/map?sel=venue-16cduf6");

    const theatreHtml = renderToStaticMarkup(
      createElement(OutListingPubPair, { row: SIX_VAUDEVILLE }),
    );
    expect(theatreHtml).toContain(OUT_LISTING_PUB_ABSENT_LINE);
    expect(theatreHtml).not.toContain("On PUBMAXX");
    expect(outListingPubPair(SIX_VAUDEVILLE).status).toBe("absent");
  });
});

describe("out honesty guard — no map pin for unmatched listings", () => {
  it("does not route an unmatched theatre row to /map?sel=", () => {
    const route = outListingRoute(SIX_VAUDEVILLE);
    expect(route?.external).toBe(true);
    expect(route?.href).toContain("ticketmaster");
    expect(route?.href).not.toContain("/map?sel=");
  });

  it("keeps unmatched Ticketmaster theatre rows off the Tonight pub surface", () => {
    const attached = attachOutVenues(
      [SIX_VAUDEVILLE, NEW_CROSS_WREX, ABBA_VOYAGE],
      SLIM_INDEX,
    );
    const selectable = new Set(SLIM_INDEX.venueIds);
    expect(tonightRowHasListedPub(SIX_VAUDEVILLE, selectable)).toBe(false);
    expect(tonightRowHasListedPub(NEW_CROSS_WREX, selectable)).toBe(false);
    const merged = mergeTonightListingRows([], attached.rows, NOW, "ready", selectable);
    expect(merged.map((row) => row.id)).toEqual(["events-tm-abba-voyage"]);
  });
});
