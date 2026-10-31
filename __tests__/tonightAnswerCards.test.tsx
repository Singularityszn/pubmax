// Tonight's three answers (design V1, 30 Oct 2026). The "On tonight" card leads
// with ONE confirmed listing when the what's-on read holds one, and hands over
// to the regular nights, in a block of their own with their own label and read
// date, only when it holds none. Regular nights are never mixed into a listing.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TonightAnswerCards, {
  TONIGHT_NO_CONFIRMED_LISTING_LINE,
  type TonightAnswerListing,
  type TonightRegularNightsView,
} from "@/components/tonight/TonightAnswerCards";
import { parseRegularNights, regularNightsForWeekday } from "@/lib/regularNights";
import {
  cheapestPintNear,
  tonightCheapestAnswer,
  tonightOnTonightListing,
} from "@/lib/tonightAnswers";
import type { WhatsOnRow } from "@/lib/whatsOn";

function committed(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "public/data/whats_on", name), "utf8"));
}

const NIGHTS = parseRegularNights({
  quiz: committed("quiz_london.json"),
  music: committed("music_london.json"),
  sport: committed("sport_attributes.json"),
});

const REGULAR: TonightRegularNightsView = {
  status: "ready",
  answer: regularNightsForWeekday(NIGHTS, 2),
};

const LISTING: TonightAnswerListing = {
  title: "Tuesday pub quiz",
  placeName: "The Fixture Arms",
  when: "20:00",
  sourceLabel: "The Fixture Arms",
  href: "/map?sel=venue-fixture",
  external: false,
};

function render(listing: TonightAnswerListing | null, regular: TonightRegularNightsView | null): string {
  return renderToStaticMarkup(
    createElement(TonightAnswerCards, {
      cheapest: null,
      listing,
      regular,
      lastTrain: { status: "no-location" },
      onShareLocation: () => undefined,
    }),
  ).replace(/&#x27;/g, "'");
}

describe("Tonight's On tonight card", () => {
  it("shows the regular-nights block, labelled and dated, when the store holds no listing", () => {
    const html = render(null, REGULAR);
    expect(html).toContain('data-answer="regular"');
    expect(html).toContain(TONIGHT_NO_CONFIRMED_LISTING_LINE.replace(/'/g, "'"));
    expect(html).toContain('data-testid="tonight-regular-nights"');
    expect(html).toContain(">Regular nights<");
    expect(html).toContain("Not tonight’s listing");
    expect(html).toContain("per Question One, read 18 July 2026");
    // A regular night is never worded as tonight's listing.
    expect(html).not.toMatch(/tonight’s listings?<|All tonight’s listings/);
  });

  it("shows the confirmed listing, and no regular nights, when the store holds one", () => {
    const html = render(LISTING, REGULAR);
    expect(html).toContain('data-answer="listing"');
    expect(html).toContain("Tuesday pub quiz");
    expect(html).toContain("via The Fixture Arms");
    expect(html).not.toContain('data-testid="tonight-regular-nights"');
    expect(html).not.toContain("Regular nights");
  });

  it("says a failed regular-nights read in words, never as an empty week", () => {
    const html = render(null, { status: "failed" });
    expect(html).toContain("couldn’t read the regular nights");
    expect(html).not.toContain('data-testid="tonight-regular-nights"');
  });

  it("offers the location door on the Last train card until a position is shared", () => {
    const html = render(LISTING, null);
    expect(html).toContain('data-testid="tonight-answer-last-train"');
    expect(html).toContain("Share location");
  });
});

describe("tonightOnTonightListing", () => {
  const row = (id: string, kind: WhatsOnRow["kind"]): WhatsOnRow => ({
    id,
    placeName: "The Anchor",
    kind,
    title: id,
    source: { label: "The Anchor", url: "https://example.com" },
    observedAt: "2026-10-30T12:00:00.000Z",
    confidence: "listed",
  }) as WhatsOnRow;

  it("leads with a night out over a drinks offer, and holds nothing when the read is empty", () => {
    expect(tonightOnTonightListing([row("deal", "deal"), row("quiz", "quiz")])?.id).toBe("quiz");
    expect(tonightOnTonightListing([row("deal", "deal")])?.id).toBe("deal");
    expect(tonightOnTonightListing([])).toBeNull();
  });
});

describe("tonightCheapestAnswer", () => {
  const venues = [
    { id: "venue-a", name: "The Anchor", lat: 51.5136, lng: -0.1365, cheapestPrice: 5.2, priceObservedAt: "2026-10-02" },
    { id: "venue-b", name: "The Bell", lat: 51.5140, lng: -0.1370, cheapestPrice: 4.6, priceObservedAt: "2026-10-02" },
    { id: "venue-c", name: "Far Away Arms", lat: 51.6, lng: -0.2, cheapestPrice: 3.0 },
  ];
  const city = [{ venueId: "venue-z", name: "The Zed", borough: "Camden", priceGbp: 3.5, chain: null, observedAt: "2026-10-02" }];

  it("picks the cheapest within a walk and says the walk", () => {
    const answer = tonightCheapestAnswer({ origin: { lat: 51.5136, lng: -0.1365 }, patch: null, nearby: venues, cityRows: city });
    expect(answer?.venueId).toBe("venue-b");
    expect(answer?.basis).toBe("walk");
    expect(answer?.placeLine).toMatch(/^~\d+ min walk$/);
    expect(cheapestPintNear(venues, { lat: 51.5136, lng: -0.1365 })?.venue.id).toBe("venue-b");
  });

  it("names the area without a position, and the city without either", () => {
    const area = tonightCheapestAnswer({
      origin: null,
      patch: { label: "Soho", near: { lat: 51.5136, lng: -0.1365 } },
      nearby: venues,
      cityRows: city,
    });
    expect(area?.placeLine).toBe("Around Soho");
    const london = tonightCheapestAnswer({ origin: null, patch: null, nearby: [], cityRows: city });
    expect(london?.basis).toBe("city");
    expect(london?.placeLine).toBe("Camden");
    expect(tonightCheapestAnswer({ origin: null, patch: null, nearby: [], cityRows: [] })).toBeNull();
  });
});
