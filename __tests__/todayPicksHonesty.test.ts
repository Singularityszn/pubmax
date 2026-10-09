// Today may not call a night empty on a read that never answered.
//
// The picks card is the surface that names an empty tonight list, and
// before this it said it whether the bundled What's-On read had answered or
// thrown. This renders the real client with each read status and reads the copy
// the card actually prints.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({
  default: () => null,
}));
vi.mock("@/components/nav/NowSegment", () => ({
  default: () => null,
}));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => null,
}));

import TodayClient from "@/app/today/TodayClient";
import { TODAY_PINTS_DEFAULT_PATCH_ID } from "@/app/today/todayPints";
import { buildDayGreeting, PICKS_DEGRADED_LINE, PICKS_EMPTY_LINE } from "@/lib/dayGreeting";
import type { TonightPickDto } from "@/lib/todayBrief";
import type { HypedPub } from "@/lib/hypedPubs";
import type { PicksListReadStatus } from "@/lib/dayGreeting";

const NOW = new Date("2026-08-16T21:00:00.000Z");

// The apostrophes in the shipped copy are HTML-escaped by the renderer, so the
// markup is decoded before it is read as the sentence a person sees.
function decode(markup: string): string {
  return markup.replace(/&#x27;/g, "'").replace(/&#x2F;/g, "/").replace(/&amp;/g, "&");
}

function renderToday(picksStatus: PicksListReadStatus, hypedPubs: HypedPub[] = [], picks: TonightPickDto[] = []): string {
  return decode(renderToStaticMarkup(
    createElement(TodayClient, {
      dateLabel: "Sunday 16 August",
      nowIso: NOW.toISOString(),
      greeting: buildDayGreeting({
        now: NOW,
        weather: null,
        dateLabel: "Sunday 16 August",
        name: null,
      }),
      weather: null,
      weatherByArea: {},
      picks,
      picksStatus,
      hypedPubs,
      mapSelectableVenueIds: ["venue-s2ppfm"],
      fact: null,
      // TodayPintsIndex is a map keyed by patch id. This test reads the picks
      // card alone, so the pints module carries no rows and renders nothing.
      pintsIndex: {
        [TODAY_PINTS_DEFAULT_PATCH_ID]: {
          patchId: TODAY_PINTS_DEFAULT_PATCH_ID,
          areaName: "Central London",
          rows: [],
        },
      },
      quietPint: null,
    }),
  ));
}

const PUB_SUGGESTION: HypedPub = {
  name: "The Devonshire",
  area: "Soho",
  venueId: "venue-s2ppfm",
  whyLine: "A sourced pub suggestion, rather than an event listing.",
  sources: [{ label: "Fixture publisher", url: "https://example.com/pub", observedAt: "2026-08-14T12:00:00.000Z" }],
  score: 1,
  mentions: 1,
};

describe("Today picks card honesty", () => {
  it("offers the sourced pub suggestions from Tonight when no events are listed", () => {
    const ready = renderToday("ready", [PUB_SUGGESTION]);
    expect(ready).toContain("Pubs people are talking about");
    expect(ready).toContain("The Devonshire");
    expect(ready).toContain('href="https://example.com/pub"');
    expect(ready).toContain("Fixture publisher");
    expect(ready).toContain('href="/map?sel=venue-s2ppfm"');
    expect(ready).not.toContain(PICKS_EMPTY_LINE.night);
  });

  it("says nothing left only when the read answered with nothing", () => {
    const ready = renderToday("ready");
    expect(ready).toContain('data-picks-status="empty"');
    expect(ready).toContain(PICKS_EMPTY_LINE.night);
  });

  it("keeps confirmed event picks when they exist", () => {
    const ready = renderToday("ready", [PUB_SUGGESTION], [{
      id: "quiz", title: "Wednesday quiz", placeName: "The Quiz Arms",
      kind: "quiz", kindLabel: "Quiz", sourceLabel: "The pub",
      priceGbp: null, lat: null, lng: null, href: "/map?sel=venue-s2ppfm", external: false,
    }]);
    expect(ready).toContain("Wednesday quiz");
    expect(ready).not.toContain("The Devonshire");
  });

  it("keeps the failed event read visible beside sourced pub suggestions", () => {
    const degraded = renderToday("degraded", [PUB_SUGGESTION]);
    expect(degraded).toContain("The Devonshire");
    expect(degraded).toContain(PICKS_DEGRADED_LINE);
    expect(degraded).not.toContain("No confirmed events listed tonight.");
  });

  it("names a failed read instead of an empty night", () => {
    const degraded = renderToday("degraded");
    expect(degraded).toContain('data-picks-status="degraded"');
    expect(degraded).toContain(PICKS_DEGRADED_LINE);
    expect(degraded).not.toContain("Nothing on tonight");
  });
});
