// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import TonightClient from "@/app/tonight/TonightClient";
import { initialTonightOutAnswer } from "@/app/tonight/initialOutAnswer";
import TonightPage from "@/app/tonight/page";
import type { OutResponse } from "@/lib/out/types";
import { loadTodayOutAnswer, loadTodayWhatsOnAnswer } from "@/lib/todayListings.server";
import type { TonightOutAnswer } from "@/lib/tonightOutListings";
import type { LoadWhatsOnResult } from "@/lib/whatsOnStore";
import type { WhatsOnRow } from "@/lib/whatsOn";
import type { HypedPub } from "@/lib/hypedPubs";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/NowSegment", () => ({ default: () => null }));
vi.mock("@/lib/venuePriceIndex", () => ({ getPricedVenues: async () => [] }));
vi.mock("@/lib/historic", () => ({ loadHistoricPubs: async () => [] }));
vi.mock("@/lib/mapEagerVenueIndex.server", () => ({
  loadMapSelectableVenueIds: async () => new Set(["venue-pub"]),
}));
vi.mock("@/lib/hypedPubs.server", () => ({ loadHypedPubs: async () => ({ rows: [] }) }));
vi.mock("@/lib/spoonsValue.server", () => ({
  readSpoonsValue: async () => ({ byVenueId: new Map() }),
}));
vi.mock("@/lib/wetherspoonsMatch.server", () => ({
  matchedWetherspoonsVenueIds: async () => new Set(),
}));
vi.mock("@/lib/todayListings.server", () => ({
  loadTodayOutAnswer: vi.fn(),
  loadTodayWhatsOnAnswer: vi.fn(),
}));

const NOW = Date.parse("2026-10-22T17:00:00Z");
const OBSERVED = "2026-10-22T09:00:00Z";
const pub: WhatsOnRow = {
  id: "pub-music",
  venueId: "venue-pub",
  placeName: "The Fixture Arms",
  kind: "music",
  startsAt: "2026-10-22T18:00:00Z",
  endsAt: "2026-10-22T21:00:00Z",
  title: "Thursday live music",
  source: { label: "Skiddle", url: "https://www.skiddle.com/whats-on/" },
  observedAt: OBSERVED,
  confidence: "listed",
};
const unmatched: WhatsOnRow = {
  ...pub, id: "theatre", venueId: undefined, placeName: "Fixture Theatre", title: "Theatre show",
};
const expired: WhatsOnRow = {
  ...pub, id: "expired", endsAt: "2026-10-22T16:00:00Z",
};
const stale: WhatsOnRow = {
  ...pub, id: "stale", observedAt: "2026-10-20T09:00:00Z",
};
const body: OutResponse = {
  status: "degraded",
  listingsStatus: "ready",
  events: [unmatched, pub, expired, stale, { ...unmatched, id: "arena", title: "Arena show" }],
  observedAt: { skiddle: OBSERVED },
  venueMatch: "ready",
  providers: [{ name: "skiddle", configured: true, rows: 5, status: "ready" }],
  attribution: [],
  reason: "Open plans could not be checked.",
  openPlansStatus: "ready",
  openPlans: [{
    crewId: "crew-1", title: "Fixture pub night", startTime: "2026-10-22T19:00:00Z",
    stopVenueId: "venue-pub", stopVenueName: "The Fixture Arms", hostHandle: "fixture",
    memberCount: 2, meetingPoint: { kind: "venue", name: "The Fixture Arms", lat: 51.5, lng: -0.1 },
  }],
};
const answer: TonightOutAnswer = { body, failed: false, pending: false };
const whatsOn: LoadWhatsOnResult = {
  rows: [{ ...pub, id: "quiz", kind: "quiz", title: "Thursday pub quiz" }],
  readStatus: "ready",
  servedAt: new Date(NOW).toISOString(),
  revalidation: { status: "measured" },
  sourceObservedAt: OBSERVED,
  sourceFreshnessKind: "provider-observed",
  kindObservedAt: { quiz: OBSERVED },
  localityBasis: "london-default",
  asOf: OBSERVED,
};

function documentFor(
  out: TonightOutAnswer,
  listings: LoadWhatsOnResult | null = whatsOn,
  hypedPubs: HypedPub[] = [],
) {
  return renderToStaticMarkup(createElement(TonightClient, {
    initialListings: { whatsOn: listings, out, renderedAt: NOW },
    mapSelectableVenueIds: ["venue-pub"],
    hypedPubs,
  }));
}

describe("Tonight's serialized Out answer", () => {
  const suggestion: HypedPub = {
    name: "The Fixture Arms", area: "Soho", venueId: "venue-pub",
    whyLine: "A sourced local recommendation.", score: 1, mentions: 1,
    sources: [{ label: "Local guide", url: "https://example.com/pub", observedAt: OBSERVED }],
  };
  const ticketmasterEvent: WhatsOnRow = {
    ...pub, id: "tm-pub-event", kind: "event", title: "Pub comedy night",
    source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
  };
  const readyOut: TonightOutAnswer = {
    ...answer, body: { ...body, events: [ticketmasterEvent], observedAt: { ticketmaster: OBSERVED } },
  };

  it.each(["ready", "empty", "failed"])(
    "does not call a hidden pub-matched nonmusic event unmatched with What's-on %s",
    (state) => {
      const listings = state === "failed" ? null : { ...whatsOn, rows: state === "empty" ? [] : whatsOn.rows };
      const doc = new DOMParser().parseFromString(documentFor(readyOut, listings), "text/html");
      expect(doc.body.textContent).not.toContain("Pub comedy night");
      expect(doc.querySelector('[data-tonight-provenance="out"]')).toBeNull();
    },
  );

  it.each([
    { label: "Wetherspoon", url: "https://www.jdwetherspoon.com/offers" },
    { label: "Greene King", url: "https://www.greeneking.co.uk/offers" },
  ])("credits chain-only What's-on rows from $label without claiming zero matches", (source) => {
    const chainRow = { ...pub, id: "chain-deal", kind: "deal" as const, title: "Thursday chain deal", source };
    const html = documentFor(
      { ...readyOut, body: { ...body, events: [], observedAt: {} } },
      { ...whatsOn, rows: [chainRow], kindObservedAt: { deal: OBSERVED } },
      [suggestion],
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const credit = doc.querySelector('[data-tonight-provenance="whats-on"]')?.textContent;
    expect(doc.body.textContent).toContain("Thursday chain deal");
    expect(credit).toBe("Pub-matched listings · Checked 22 Oct · via what’s-on");
  });

  it("counts only the displayed Out music card beside a hidden pub event and an unmatched event", () => {
    const doc = new DOMParser().parseFromString(documentFor({
      ...readyOut,
      body: { ...body, events: [ticketmasterEvent, pub, unmatched], observedAt: { skiddle: OBSERVED, ticketmaster: OBSERVED } },
    }), "text/html");
    expect(doc.body.textContent).toContain("Thursday live music");
    expect(doc.body.textContent).not.toContain("Pub comedy night");
    expect(doc.querySelector('[data-tonight-provenance="out"]')?.textContent)
      .toBe("1 listing via Skiddle · Checked 22 Oct");
  });

  it.each([OBSERVED, "not-a-date"])("credits an unmatched Out read separately from displayed What's-on cards: %s", (observedAt) => {
    const doc = new DOMParser().parseFromString(documentFor({
      ...readyOut,
      body: { ...body, events: [{ ...unmatched, observedAt }], observedAt: { skiddle: observedAt } },
    }), "text/html");
    expect(doc.querySelector('[data-tonight-provenance="whats-on"]')?.textContent)
      .toBe("1 listing · Checked 22 Oct · via what’s-on");
    expect(doc.querySelector('[data-tonight-provenance="out"]')?.textContent)
      .toBe(`No pub-matched events via Skiddle${observedAt === OBSERVED ? " · Checked 22 Oct" : ""}`);
    expect(doc.querySelector('[data-tonight-provenance="undated-out"]')?.textContent ?? null)
      .toBe(observedAt === OBSERVED ? null : "The source check date is not recorded.");
  });

  it.each([
    { name: "pending", failed: false, pending: true, listingsStatus: "ready", venueMatch: "ready" },
    { name: "failed", failed: true, pending: false, listingsStatus: "ready", venueMatch: "ready" },
    { name: "degraded", failed: false, pending: false, listingsStatus: "degraded", venueMatch: "ready" },
    { name: "not configured", failed: false, pending: false, listingsStatus: "not-configured", venueMatch: "ready" },
    { name: "unavailable matches", failed: false, pending: false, listingsStatus: "ready", venueMatch: "unavailable" },
  ] as const)("does not call the $name Out read an empty checked result", ({ failed, pending, listingsStatus, venueMatch }) => {
    const doc = new DOMParser().parseFromString(documentFor({
      failed, pending,
      body: { ...body, events: [unmatched], listingsStatus, venueMatch },
    }), "text/html");
    expect(doc.querySelector('[data-tonight-provenance="out"]')).toBeNull();
  });

  it("serializes less than 2,500 Out bytes from a 78-row answer at the page boundary", async () => {
    const largeAnswer: TonightOutAnswer = {
      ...answer,
      body: {
        ...body,
        events: [unmatched, pub, ...Array.from({ length: 76 }, (_, index) => ({
          ...unmatched,
          id: `theatre-${index}`,
          title: "Discarded theatre programme ".repeat(12),
        }))],
      },
    };
    vi.mocked(loadTodayOutAnswer).mockResolvedValue(largeAnswer);
    vi.mocked(loadTodayWhatsOnAnswer).mockResolvedValue(whatsOn);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const page = await TonightPage();
      const initial = page.props.initialListings;

      expect(Buffer.byteLength(JSON.stringify(largeAnswer))).toBeGreaterThan(40_000);
      expect(Buffer.byteLength(JSON.stringify(initial.out))).toBeLessThan(2_500);
      expect(initial).toEqual({
        whatsOn,
        out: { ...answer, body: { ...body, events: [unmatched, pub] } },
        renderedAt: NOW,
      });
      expect(documentFor(initial.out)).toBe(documentFor(largeAnswer));
      expect(largeAnswer.body?.events).toHaveLength(78);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps eligible pub events and only one row for the unmatched-listings notice", () => {
    const initial = initialTonightOutAnswer(answer, NOW);

    expect(initial.body?.events.map((row) => row.id)).toEqual(["theatre", "pub-music"]);
    expect(initial).toEqual({ ...answer, body: { ...body, events: [unmatched, pub] } });
    expect(answer.body?.events).toHaveLength(5);
  });

  it.each([
    { state: "ready", listings: whatsOn },
    { state: "empty", listings: { ...whatsOn, rows: [] } },
    { state: "failed", listings: null },
  ])(
    "preserves the rendered listings, source dates, and notices for a $state read",
    ({ listings }) => {
      const before = documentFor(answer, listings);
      const after = documentFor(initialTonightOutAnswer(answer, NOW), listings);

      expect(after).toBe(before);
      expect(after).toContain("Some event listings are not matched to a pub.");
    },
  );

  it.each([
    { body: null, failed: true, pending: false },
    { body: null, failed: false, pending: true },
    { ...answer, body: { ...body, events: [], listingsStatus: "not-configured" as const } },
  ])("preserves unavailable and empty answers", (input) => {
    expect(initialTonightOutAnswer(input, NOW)).toEqual(input);
  });
});
