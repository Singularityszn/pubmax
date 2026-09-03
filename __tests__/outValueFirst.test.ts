// @vitest-environment jsdom

// Out leads with the night, not with an apology about it.
//
// UI audit, 2026-09-01, production, 390x844. Three findings on one page:
//
//  1. The page led with "57 more listings tonight are at places we don't list
//     yet", its source credit and a way onward, ALL above the single listing it
//     did have. The word "more" was answering nothing at that point.
//  2. "Also picked this week" answered "Picks need a fresh check." - our own
//     maintenance, shown to a drinker.
//  3. The PUBMAXX venue badge drew the Crossing X in one ink colour at 18px,
//     one line under a Ticketmaster credit, where it reads as another
//     company's logo rather than ours.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { MARK_COLORS } from "@/components/brand/PubmaxxMark";
import { OutListingPubPair } from "@/components/out/OutListingPubPair";
import { OUT_LISTING_VENUE_BADGE_LABEL } from "@/lib/outDesktopGrouping";
import {
  EDITORIAL_DEGRADED_EMPTY_LINE,
  EDITORIAL_EMPTY_LINE,
  EDITORIAL_STALE_LINE,
} from "@/lib/editorial";
import type { WhatsOnRow } from "@/lib/whatsOn";

const matchedRow: WhatsOnRow = {
  id: "mark-render",
  kind: "event",
  title: "Comedy",
  venueId: "venue-mark",
  placeName: "The Comedy Store",
  source: { label: "Ticketmaster", url: "https://example.com/event/mark" },
  observedAt: "2026-08-14T12:00:00.000Z",
  confidence: "listed",
};

function renderedPubPair(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(OutListingPubPair, { row: matchedRow }),
  );
  return host;
}

describe("an empty rail speaks to a drinker", () => {
  it("says what the reader gets, never what we need to do", () => {
    for (const line of [
      EDITORIAL_STALE_LINE,
      EDITORIAL_EMPTY_LINE,
      EDITORIAL_DEGRADED_EMPTY_LINE,
    ]) {
      expect(line, line).not.toMatch(/needs? a fresh|refresh|snapshot|stale|poll/i);
    }
  });

  it("keeps the three states distinguishable", () => {
    const lines = [
      EDITORIAL_STALE_LINE,
      EDITORIAL_EMPTY_LINE,
      EDITORIAL_DEGRADED_EMPTY_LINE,
    ];
    expect(new Set(lines).size).toBe(3);
    // A withheld snapshot may not claim the week is empty: it did not look.
    expect(EDITORIAL_STALE_LINE).not.toBe(EDITORIAL_EMPTY_LINE);
  });
});

describe("the venue badge wears our own mark", () => {
  it("renders coral arms and a bright ember in the venue badge", () => {
    const host = renderedPubPair();
    const mark = host.querySelector("svg.pubmaxxMark");
    expect(mark).not.toBeNull();
    const fills = mark
      ? [...mark.querySelectorAll("polygon, circle")].map((shape) =>
          shape.getAttribute("fill"),
        )
      : [];

    expect(fills.filter((fill) => fill === MARK_COLORS.coral)).toHaveLength(3);
    expect(fills).toContain(MARK_COLORS.bright);
    expect(fills).not.toContain("currentColor");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
  });

  it("still names the venue in words, so the mark is not the only claim", () => {
    // Asserted against the OWNING constant rather than a retyped string. A
    // guard that spells the label itself is a second copy of the thing it is
    // guarding: rename the label and this test keeps passing against words no
    // reader sees any more.
    expect(
      renderedPubPair().querySelector(".outListingPubPairLabel")?.textContent,
    ).toBe(OUT_LISTING_VENUE_BADGE_LABEL);
  });
});
