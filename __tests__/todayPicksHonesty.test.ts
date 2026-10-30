// Today picks honesty, after the launch review (30 Oct 2026, design V1).
//
// /today used to carry Tonight's picks and, on an empty night, Tonight's
// recommended pubs, so the two pages showed the same five pubs. The honest fix
// is that the day page claims nothing about tonight at all: no picks section,
// no picks state, none of Tonight's recommended pubs, and one link to the page
// that owns tonight's listings.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/NowSegment", () => ({ default: () => null }));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => null }));

import TodayClient from "@/app/today/TodayClient";
import { buildDayGreeting } from "@/lib/dayGreeting";

const NOW = new Date("2026-10-30T11:00:00.000Z");

function renderToday(): string {
  return renderToStaticMarkup(
    createElement(TodayClient, {
      dateLabel: "Friday 30 October",
      nowIso: NOW.toISOString(),
      greeting: buildDayGreeting({ now: NOW, weather: null, dateLabel: "Friday 30 October", name: null }),
      weather: null,
      weatherByArea: {},
      fact: null,
      pintsIndex: {},
      quietPint: null,
    }),
  );
}

describe("Today picks card honesty", () => {
  it("claims nothing about tonight: no picks, no picks state, no recommended pubs", () => {
    const html = renderToday();
    expect(html).not.toContain('data-testid="today-picks"');
    expect(html).not.toContain("data-picks-state");
    expect(html).not.toContain("data-picks-status");
    expect(html).not.toContain('data-testid="tonight-hyped-list"');
    expect(html).not.toContain("No confirmed events listed tonight.");
  });

  it("hands tonight to the page that owns it", () => {
    expect(renderToday()).toMatch(/href="\/tonight"[^>]*>What’s on tonight/);
  });
});
