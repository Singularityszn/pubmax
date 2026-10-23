// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import TonightClient from "@/app/tonight/TonightClient";
import { initialTonightOutAnswer } from "@/app/tonight/initialOutAnswer";
import TonightPage from "@/app/tonight/page";
import { AREA_PHOTOS } from "@/lib/landingImagery";
import type { OutResponse } from "@/lib/out/types";
import { loadTodayOutAnswer, loadTodayWhatsOnAnswer } from "@/lib/todayListings.server";
import type { TonightOutAnswer } from "@/lib/tonightOutListings";
import type { LoadWhatsOnResult } from "@/lib/whatsOnStore";
import type { WhatsOnRow } from "@/lib/whatsOn";

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

function documentFor(out: TonightOutAnswer, listings: LoadWhatsOnResult | null = whatsOn) {
  return renderToStaticMarkup(createElement(TonightClient, {
    initialListings: { whatsOn: listings, out, renderedAt: NOW },
    mapSelectableVenueIds: ["venue-pub"],
  }));
}

describe("Tonight's server photo composition", () => {
  it("passes founder and licensed area photos plus the London fallback to the client", async () => {
    vi.mocked(loadTodayOutAnswer).mockResolvedValue(answer);
    vi.mocked(loadTodayWhatsOnAnswer).mockResolvedValue(whatsOn);

    const page = await TonightPage();
    const { areaPhotos, londonPhoto, pubPhotos } = page.props.photos;

    expect(areaPhotos["canary-wharf"]).toMatchObject({
      key: "collage:canary-wharf-night",
      place: "Canary Wharf",
      scope: "area",
      namesPlace: true,
      credit: { kind: "founder" },
    });
    for (const [slug, photoId] of Object.entries(AREA_PHOTOS)) {
      expect(areaPhotos[slug]).toMatchObject({
        key: `landing:${photoId}`,
        scope: "area",
        credit: { kind: "licensed" },
      });
    }
    expect(areaPhotos.clapham).toBeUndefined();
    expect(londonPhoto).toMatchObject({ key: "landing:city-of-london", scope: "london" });
    expect(pubPhotos).toEqual({});
  });
});

describe("Tonight's serialized Out answer", () => {
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
