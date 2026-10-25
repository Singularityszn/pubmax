// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useOutListings } from "@/components/out/useOutListings";
import { useWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
import TonightClient from "@/app/tonight/TonightClient";
import { initialTonightOutAnswer } from "@/app/tonight/initialOutAnswer";
import TonightPage from "@/app/tonight/page";
import { AREA_PHOTOS } from "@/lib/landingImagery";
import type { OutResponse } from "@/lib/out/types";
import { loadTodayOutAnswer, loadTodayWhatsOnAnswer } from "@/lib/todayListings.server";
import type { TonightOutAnswer } from "@/lib/tonightOutListings";
import type { LoadWhatsOnResult } from "@/lib/whatsOnStore";
import type { WhatsOnRow } from "@/lib/whatsOn";
import type { HypedPub } from "@/lib/hypedPubs";

vi.mock("@/components/out/useOutListings", () => ({ useOutListings: vi.fn() }));
vi.mock("@/components/map/useWhatsOnTonight", () => ({ useWhatsOnTonight: vi.fn() }));

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
const STALE_OBSERVED = "2026-10-20T09:00:00Z";
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
  ...pub, id: "stale", observedAt: STALE_OBSERVED,
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
  path: "full" | "initial" | "browser" = "full",
) {
  if (path === "browser") {
    vi.mocked(useOutListings).mockReturnValue({
      ...out, body: out.body as OutResponse | null, retry: vi.fn(),
    });
    vi.mocked(useWhatsOnTonight).mockReturnValue({
      rows: listings?.rows ?? [], summary: new Map(),
      status: listings ? listings.rows.length > 0 ? "ready" : "empty" : "error",
      asOf: listings?.asOf ?? null,
      sourceObservedAt: listings?.sourceObservedAt ?? null,
      sourceFreshnessKind: listings?.sourceFreshnessKind ?? "unknown",
      kindObservedAt: listings?.kindObservedAt ?? {}, retry: vi.fn(),
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(NOW);
    try {
      return renderToStaticMarkup(createElement(TonightClient, {
        mapSelectableVenueIds: ["venue-pub"], hypedPubs,
      }));
    } finally {
      clock.mockRestore();
    }
  }
  return renderToStaticMarkup(createElement(TonightClient, {
    initialListings: { whatsOn: listings, out: path === "initial" ? initialTonightOutAnswer(out, NOW) : out, renderedAt: NOW },
    mapSelectableVenueIds: ["venue-pub"],
    hypedPubs,
  }));
}

beforeEach(() => {
  vi.mocked(useOutListings).mockReturnValue({ body: null, failed: false, pending: true, retry: vi.fn() });
  vi.mocked(useWhatsOnTonight).mockReturnValue({
    rows: [], summary: new Map(), status: "idle", asOf: null,
    sourceObservedAt: null, sourceFreshnessKind: "unknown", kindObservedAt: {}, retry: vi.fn(),
  });
});

describe("Tonight's server photo composition", () => {
  it("dates the prepared page separately from the older listing source", () => {
    const document = new DOMParser().parseFromString(documentFor(answer), "text/html");
    const stamp = document.querySelector('[data-testid="brief-prepared-at"]');
    expect(stamp?.querySelector("time")?.dateTime).toBe("2026-10-22T17:00:00.000Z");
    expect(stamp?.textContent).toContain("Source dates can be older");
    expect(stamp?.querySelector("time")?.dateTime).not.toBe(OBSERVED);
  });

  it("keeps the original preparation timestamp when browser listings replace the serialized answer", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const root = createRoot(target);
    const clock = vi.spyOn(Date, "now").mockReturnValue(NOW + 60 * 60 * 1000);
    const props = {
      initialListings: { whatsOn, out: answer, renderedAt: NOW },
      mapSelectableVenueIds: ["venue-pub"],
      hypedPubs: [],
    };
    try {
      await act(async () => root.render(createElement(TonightClient, props)));
      expect(target.textContent).toContain("Thursday pub quiz");
      vi.mocked(useOutListings).mockReturnValue({ ...answer, body, pending: false, retry: vi.fn() });
      vi.mocked(useWhatsOnTonight).mockReturnValue({
        rows: [{ ...pub, id: "refreshed-quiz", kind: "quiz", title: "Browser refreshed quiz" }],
        summary: new Map(), status: "ready", asOf: OBSERVED,
        sourceObservedAt: OBSERVED, sourceFreshnessKind: "provider-observed",
        kindObservedAt: { quiz: OBSERVED }, retry: vi.fn(),
      });
      await act(async () => root.render(createElement(TonightClient, props)));
      expect(target.textContent).toContain("Browser refreshed quiz");
      expect(target.textContent).not.toContain("Thursday pub quiz");
      expect(target.querySelector('[data-testid="brief-prepared-at"] time')?.getAttribute("datetime"))
        .toBe("2026-10-22T17:00:00.000Z");
      await act(async () => root.render(createElement(TonightClient, {
        ...props,
        initialListings: { ...props.initialListings, renderedAt: NOW + 30 * 60 * 1000 },
      })));
      expect(target.querySelector('[data-testid="brief-prepared-at"] time')?.getAttribute("datetime"))
        .toBe("2026-10-22T17:30:00.000Z");
      expect(target.textContent).toContain("Browser refreshed quiz");
    } finally {
      await act(async () => root.unmount());
      clock.mockRestore();
      target.remove();
    }
  });

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

  describe.each(["initial", "browser"] as const)("%s source evidence", (path) => {
    const renderDocument = (out: TonightOutAnswer, listings: LoadWhatsOnResult | null = whatsOn, pubs: HypedPub[] = []) =>
      documentFor(out, listings, pubs, path);

    it.each(["ready", "empty", "pending", "failed"])(
      "keeps %s public copy free of map implementation jargon",
      (state) => {
        const out = state === "ready" ? readyOut : {
          body: state === "empty" ? { ...body, events: [], openPlans: [] } : null,
          pending: state === "pending",
          failed: state === "failed",
        };
        const listings = state === "ready" ? whatsOn : state === "empty" ? { ...whatsOn, rows: [] } : null;
        const doc = new DOMParser().parseFromString(renderDocument(out, listings), "text/html");
        expect(doc.querySelector("h1")?.textContent).toBe("What’s on across London tonight.");
        for (const copy of [
          doc.body.textContent,
          ...Array.from(doc.querySelectorAll("[aria-label]"), (element) => element.getAttribute("aria-label")),
        ]) {
          expect(copy).not.toMatch(/same spine as the map/iu);
        }
      },
    );

    it.each(["ready", "empty", "failed"])(
      "does not call a hidden pub-matched nonmusic event unmatched with What's-on %s",
      (state) => {
        const listings = state === "failed" ? null : { ...whatsOn, rows: state === "empty" ? [] : whatsOn.rows };
        const doc = new DOMParser().parseFromString(renderDocument(readyOut, listings), "text/html");
        expect(doc.body.textContent).not.toContain("Pub comedy night");
        expect(doc.querySelector('[data-tonight-provenance="out"]')).toBeNull();
      },
    );

    it.each([
      { label: "Wetherspoon", url: "https://www.jdwetherspoon.com/offers" },
      { label: "Greene King", url: "https://www.greeneking.co.uk/offers" },
    ])("credits chain-only What's-on rows from $label without claiming zero matches", (source) => {
      const chainRow = { ...pub, id: "chain-deal", kind: "deal" as const, title: "Thursday chain deal", source };
      const html = renderDocument(
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
      const doc = new DOMParser().parseFromString(renderDocument({
        ...readyOut,
        body: { ...body, events: [ticketmasterEvent, pub, stale, unmatched], observedAt: { skiddle: OBSERVED, ticketmaster: OBSERVED } },
      }), "text/html");
      expect(doc.body.textContent).toContain("Thursday live music");
      expect(doc.body.textContent).not.toContain("Pub comedy night");
      expect(doc.querySelector('[data-tonight-provenance="out"]')?.textContent)
        .toBe("1 listing via Skiddle · Checked 22 Oct");
    });

    it.each([OBSERVED, undefined, "not-a-date"])("credits an unmatched Out read separately from displayed What's-on cards: %s", (observedAt) => {
      const doc = new DOMParser().parseFromString(renderDocument({
        ...readyOut,
        body: { ...body, events: [{ ...unmatched, observedAt: observedAt ?? "" }], observedAt: observedAt ? { skiddle: observedAt } : {} },
      }), "text/html");
      expect(doc.querySelector('[data-tonight-provenance="whats-on"]')?.textContent)
        .toBe("1 listing · Checked 22 Oct · via what’s-on");
      expect(doc.querySelector('[data-tonight-provenance="out"]')?.textContent)
        .toBe(`No pub-matched events via Skiddle${observedAt === OBSERVED ? " · Checked 22 Oct" : " · The source check date is not recorded."}`);
      expect(doc.querySelector('[data-tonight-provenance="undated-out"]')?.textContent ?? null)
        .toBe(observedAt === OBSERVED ? null : " · The source check date is not recorded.");
    });

    it.each([
      { label: "", observedAt: "", expected: "Ticketmaster and an unrecorded source", dated: false },
      { label: "Skiddle", observedAt: "", expected: "Ticketmaster and Skiddle", dated: false },
      { label: "Skiddle", observedAt: OBSERVED, expected: "Ticketmaster and Skiddle", dated: true },
    ])("preserves mixed-source attribution and date uncertainty: $label / $observedAt", ({ label, observedAt, expected, dated }) => {
      const doc = new DOMParser().parseFromString(renderDocument({
        ...readyOut,
        body: {
          ...body,
          events: [
            { ...unmatched, source: ticketmasterEvent.source, observedAt },
            { ...unmatched, id: "other-source", source: { label, url: "https://example.com/event" }, observedAt },
          ],
          observedAt: { ticketmaster: OBSERVED, skiddle: OBSERVED },
        },
      }, whatsOn, [suggestion]), "text/html");
      expect(doc.querySelector('[data-tonight-provenance="out"]')?.textContent)
        .toBe(`No pub-matched events via ${expected}${dated ? " · Checked 22 Oct" : " · The source check date is not recorded."}`);
      expect(doc.querySelector('[data-tonight-provenance="undated-out"]')?.textContent ?? null)
        .toBe(dated ? null : " · The source check date is not recorded.");
    });

    it.each([
      { name: "pending", failed: false, pending: true, listingsStatus: "ready", venueMatch: "ready" },
      { name: "failed", failed: true, pending: false, listingsStatus: "ready", venueMatch: "ready" },
      { name: "degraded", failed: false, pending: false, listingsStatus: "degraded", venueMatch: "ready" },
      { name: "not configured", failed: false, pending: false, listingsStatus: "not-configured", venueMatch: "ready" },
      { name: "unavailable matches", failed: false, pending: false, listingsStatus: "ready", venueMatch: "unavailable" },
    ] as const)("does not call the $name Out read an empty checked result", ({ failed, pending, listingsStatus, venueMatch }) => {
      const doc = new DOMParser().parseFromString(renderDocument({
        failed, pending,
        body: { ...body, events: [unmatched], listingsStatus, venueMatch },
      }), "text/html");
      expect(doc.querySelector('[data-tonight-provenance="out"]')).toBeNull();
    });

    it.each([{ otherEvents: [] }, { otherEvents: [unmatched] }])("retains a stale pub match when display filtering removes it: $otherEvents", ({ otherEvents }) => {
      const doc = new DOMParser().parseFromString(renderDocument({
        ...readyOut,
        body: { ...body, events: [stale, ...otherEvents], observedAt: { skiddle: STALE_OBSERVED } },
      }, { ...whatsOn, rows: [] }, [suggestion]), "text/html");
      expect(doc.body.textContent).not.toContain("Thursday live music");
      expect(doc.querySelector('[data-tonight-provenance="out"]')).toBeNull();
    });

    it.each(["2026-10-21T09:00:00Z", "not-a-date"])("preserves all unmatched publishers and their source dates: %s", (observedAt) => {
      const doc = new DOMParser().parseFromString(renderDocument({
        ...readyOut,
        body: {
          ...body,
          events: [unmatched, { ...ticketmasterEvent, venueId: undefined, observedAt }],
          observedAt: {},
        },
      }), "text/html");
      expect(doc.querySelector('[data-tonight-provenance="out"]')?.textContent)
        .toBe(`No pub-matched events via Skiddle and Ticketmaster${observedAt === "not-a-date" ? " · The source check date is not recorded." : " · Checked 21 Oct"}`);
      expect(doc.querySelector('[data-tonight-provenance="undated-out"]')?.textContent ?? null)
        .toBe(observedAt === "not-a-date" ? " · The source check date is not recorded." : null);
    });

    it("credits a truly empty read using actual provider checks", () => {
      const doc = new DOMParser().parseFromString(renderDocument({
        ...readyOut, body: { ...body, events: [], observedAt: { ticketmaster: OBSERVED } },
      }), "text/html");
      expect(doc.querySelector('[data-tonight-provenance="out"]')?.textContent)
        .toBe("No pub-matched events via Ticketmaster · Checked 22 Oct");
    });
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
        out: {
          ...answer, body: { ...body, events: [unmatched, pub] },
          sourceEvidence: {
            hasPubMatches: true,
            sources: { labels: ["Skiddle"], oldest: "2026-10-22T09:00:00Z", dated: true },
          },
        },
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
    expect(initial).toEqual({
      ...answer, body: { ...body, events: [unmatched, pub] },
      sourceEvidence: {
        hasPubMatches: true,
        sources: { labels: ["Skiddle"], oldest: "2026-10-22T09:00:00Z", dated: true },
      },
    });
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
    const initial = initialTonightOutAnswer(input, NOW);
    expect(initial.body).toEqual(input.body);
    expect(initial.failed).toBe(input.failed);
    expect(initial.pending).toBe(input.pending);
  });
});
