// A listing checked ten days ago is not a listing for tonight.
//
// Live build, 17 Oct 2026: /tonight printed "2 listings · Checked 7 Oct" over
// two Newcastle vs Aston Villa screenings (Wolfpack, The Wellington) that the
// pubs' own pages had listed on 7 October. The page already had the rule for
// how old a read may be and still say what is on tonight (a day), but only the
// quiet-night stamp asked it. These pin the same day onto every listing row,
// with the deal kind keeping the age-caption rule it already has.

import { describe, expect, it } from "vitest";

import { groupTonightListings } from "@/lib/tonightListGrouping";
import {
  filterTonightPubSurfaceRows,
  isTonightCheckedRow,
  tonightLedeComposition,
  tonightProvenanceCredits,
  tonightWhatsOnObservedAt,
  type TonightOutAnswer,
} from "@/lib/tonightOutListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

const NOW = Date.parse("2026-10-17T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

// The two rows the live page showed, as the bundled artifact carries them.
const WELLINGTON: WhatsOnRow = {
  placeName: "The Wellington",
  lat: 51.5036385,
  lng: -0.111312,
  venueId: "venue-13b8v6f",
  source: {
    label: "The Wellington website",
    url: "https://www.wellingtonhotelwaterloo.co.uk/live-sport",
  },
  observedAt: "2026-10-07T18:42:14.812Z",
  confidence: "listed",
  id: "own-site-9dae11040019950d3a2bf34b",
  kind: "sport",
  title: "Football: Premier League: Newcastle vs Aston Villa",
  startsAt: "2026-10-17T17:30:00+01:00",
};
const WOLFPACK: WhatsOnRow = {
  placeName: "Wolfpack",
  lat: 51.4813027,
  lng: -0.1981142,
  venueId: "venue-3svb24",
  source: { label: "Wolfpack website", url: "https://wolfpackbars.com/events" },
  observedAt: "2026-10-07T19:23:41.287Z",
  confidence: "listed",
  id: "own-site-1ba480051d3c5f0325dc1145",
  kind: "sport",
  title: "Premier League: Newcastle United vs Aston Villa",
  startsAt: "2026-10-17T17:30:00+01:00",
};

const emptyReadyOut: TonightOutAnswer = {
  body: { status: "ready", events: [], venueMatch: "ready" },
  failed: false,
  pending: false,
};

function checkedAgo(row: WhatsOnRow, hours: number): WhatsOnRow {
  return { ...row, observedAt: new Date(NOW - hours * HOUR).toISOString() };
}

describe("a Tonight listing must have been checked within the day", () => {
  it("does not present the 7 October fixtures as tonight on 17 October", () => {
    const composed = tonightLedeComposition([WELLINGTON, WOLFPACK], emptyReadyOut, "ready", NOW);
    expect(composed.primaryListingRows).toEqual([]);
    expect(composed.listingRows).toEqual([]);
    // Both reads answered and nothing current is left: the honest quiet night,
    // never an error and never a ready page over stale rows.
    expect(composed.listingsStatus).toBe("empty");
  });

  it("does not date the emptied night to the stale read either", () => {
    const observedAt = tonightWhatsOnObservedAt({
      renderedGroups: [],
      outEvents: [],
      kindObservedAt: { sport: WOLFPACK.observedAt },
      now: NOW,
    });
    expect(observedAt).toBeNull();
    const credits = tonightProvenanceCredits({
      renderedGroups: groupTonightListings([], null),
      outEvents: [],
      whatsOnChecked: null,
    });
    expect(credits.whatsOn).not.toMatch(/listing/);
    expect(credits.whatsOn).not.toMatch(/7 Oct/);
  });

  it("keeps the same fixtures once the pubs' pages were read this morning", () => {
    const fresh = [checkedAgo(WELLINGTON, 6), checkedAgo(WOLFPACK, 6)];
    const composed = tonightLedeComposition(fresh, emptyReadyOut, "ready", NOW);
    expect(composed.primaryListingRows.map((row) => row.id).sort()).toEqual(
      [WELLINGTON.id, WOLFPACK.id].sort(),
    );
    expect(composed.listingsStatus).toBe("ready");
  });

  it("draws the line at a day, the same bound the quiet-night stamp uses", () => {
    expect(isTonightCheckedRow(checkedAgo(WELLINGTON, 23), NOW)).toBe(true);
    expect(isTonightCheckedRow(checkedAgo(WELLINGTON, 25), NOW)).toBe(false);
    expect(
      filterTonightPubSurfaceRows([checkedAgo(WELLINGTON, 23), checkedAgo(WOLFPACK, 25)], NOW).map(
        (row) => row.id,
      ),
    ).toEqual([WELLINGTON.id]);
  });

  it("fails closed when a row's check cannot be dated", () => {
    expect(isTonightCheckedRow({ ...WELLINGTON, observedAt: "not-a-date" }, NOW)).toBe(false);
  });

  it("applies to the Out lane's rows as well as What's-On's", () => {
    const staleOut: TonightOutAnswer = {
      body: { status: "ready", events: [WELLINGTON], venueMatch: "ready" },
      failed: false,
      pending: false,
    };
    // The spine answered, so the Out rows are eligible to land at all.
    const composed = tonightLedeComposition([], staleOut, "ready", NOW);
    expect(composed.listingRows).toEqual([]);
    expect(composed.listingsStatus).toBe("empty");
  });

  it("leaves a deal to its own rule, which says the listing's age beside it", () => {
    const deal: WhatsOnRow = {
      ...WELLINGTON,
      id: "deal-wellington-happy-hour",
      kind: "deal",
      title: "Happy hour",
      startsAt: "2026-10-17T16:00:00+01:00",
      endsAt: "2026-10-17T19:00:00+01:00",
    };
    expect(isTonightCheckedRow(deal, NOW)).toBe(true);
    expect(filterTonightPubSurfaceRows([deal], NOW).map((row) => row.id)).toEqual([deal.id]);
  });
});
