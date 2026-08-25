import { describe, expect, it } from "vitest";

import {
  filterTonightPubSurfaceRows,
  mergeTonightListingRows,
  tonightListingsStatus,
  tonightProvenanceCredits,
  tonightRowHasListedPub,
  tonightRowLinks,
  type TonightOutAnswer,
} from "@/lib/tonightOutListings";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { checkedLabel } from "@/lib/whatsOnBadges";

const NOW = Date.parse("2026-09-01T00:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();
const TONIGHT_START = new Date(NOW + 60 * 60_000).toISOString();
const SELECTABLE = new Set(["venue-the-dove", "venue-soho-theatre"]);

function row(partial: Partial<WhatsOnRow> & Pick<WhatsOnRow, "id" | "title">): WhatsOnRow {
  return {
    placeName: "Soho Theatre",
    kind: "event",
    startsAt: TONIGHT_START,
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
    observedAt: NOW_ISO,
    confidence: "listed",
    ...partial,
  };
}

const matchedOut = row({
  id: "tm-matched",
  title: "Quiz at the Dove",
  venueId: "venue-the-dove",
  placeName: "The Dove",
});

const unmatchedTheatre = row({
  id: "tm-o2",
  title: "Arena show",
  placeName: "The O2",
});

const unknownVenueId = row({
  id: "tm-bad-id",
  title: "Mystery pub",
  venueId: "venue-not-on-map",
  placeName: "Nowhere Arms",
});

describe("/tonight pub surface", () => {
  it("drops unmatched Ticketmaster theatre rows and keeps only pub-matched Out events", () => {
    const merged = mergeTonightListingRows(
      [],
      [unmatchedTheatre, matchedOut],
      NOW,
      "error",
      SELECTABLE,
    );
    expect(merged.map((item) => item.id)).toEqual(["tm-matched"]);
  });

  it("keeps provenance counts aligned with the rendered pub list", () => {
    const outEvents = [unmatchedTheatre, matchedOut];
    const merged = mergeTonightListingRows([], outEvents, NOW, "error", SELECTABLE);
    const credits = tonightProvenanceCredits({
      merged,
      outEvents: filterTonightPubSurfaceRows(outEvents, NOW, SELECTABLE),
      whatsOnChecked: null,
      outObservedAt: {},
    });
    expect(merged).toHaveLength(1);
    expect(credits.out).toBe(`1 listing via Ticketmaster · ${checkedLabel(NOW_ISO)}`);
  });

  it("withholds map links for venue ids the eager index does not carry", () => {
    expect(tonightRowLinks(matchedOut, SELECTABLE).mapHref).toBe(
      "/map?sel=venue-the-dove",
    );
    expect(tonightRowLinks(unknownVenueId, SELECTABLE).mapHref).toBeNull();
    expect(tonightRowLinks(matchedOut, null).mapHref).toBeNull();
  });

  it("shows an honest empty night when What's-On answered empty, never a stale Out dump", () => {
    const outWithOnlyUnmatched: TonightOutAnswer = {
      body: {
        status: "ready",
        events: [unmatchedTheatre, row({ id: "tm-2", title: "West End", placeName: "Palace Theatre" })],
      },
      failed: false,
      pending: false,
    };
    expect(
      mergeTonightListingRows([], outWithOnlyUnmatched.body?.events ?? [], NOW, "empty", SELECTABLE),
    ).toEqual([]);
    expect(
      tonightListingsStatus("empty", outWithOnlyUnmatched, NOW, [], SELECTABLE),
    ).toBe("empty");
  });

  it("does not call ready when only unmatched Out rows survived filtering", () => {
    const outAnswer: TonightOutAnswer = {
      body: { status: "ready", events: [unmatchedTheatre] },
      failed: false,
      pending: false,
    };
    // What's-On failed, so the page stays in error even when Out had nothing pub-shaped.
    expect(tonightListingsStatus("error", outAnswer, NOW, [], SELECTABLE)).toBe("error");
    expect(
      mergeTonightListingRows([], outAnswer.body?.events ?? [], NOW, "error", SELECTABLE),
    ).toEqual([]);
  });

  it("drops What's-On rows with no listed pub and past rows from the spine", () => {
    const quiz = row({
      id: "quiz-1",
      kind: "quiz",
      title: "Quiz",
      venueId: "venue-the-dove",
      placeName: "The Dove",
      source: { label: "Pub listing", url: "https://example.com/quiz" },
    });
    const noVenue = row({
      id: "quiz-ghost",
      kind: "quiz",
      title: "Ghost quiz",
      placeName: "Somewhere",
      source: { label: "Pub listing", url: "https://example.com/ghost" },
    });
    const finished = row({
      id: "quiz-finished",
      kind: "quiz",
      title: "Finished quiz",
      venueId: "venue-the-dove",
      startsAt: new Date(NOW - 8 * 60 * 60_000).toISOString(),
      source: { label: "Pub listing", url: "https://example.com/old" },
    });
    const merged = mergeTonightListingRows(
      [quiz, noVenue, finished],
      [],
      NOW,
      "ready",
      SELECTABLE,
    );
    expect(merged.map((item) => item.id)).toEqual(["quiz-1"]);
    expect(tonightRowHasListedPub(quiz, SELECTABLE)).toBe(true);
    expect(tonightRowHasListedPub(noVenue, SELECTABLE)).toBe(false);
    expect(tonightRowHasListedPub(unknownVenueId, SELECTABLE)).toBe(false);
  });
});
