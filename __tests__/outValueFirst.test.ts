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
//
// Live walk B4, 2026-09-07, carried the first finding to its end: the count was
// not merely above the listings, it was INSTEAD of them, because the surface
// rendered only rows it had matched to a pub. The fences below now hold the
// law that replaced it - every sourced listing is a row, the pub answer is a
// footnote on that row, and the page's primary is the first listing.

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const REPO_ROOT = join(__dirname, "..");
const outClient = readFileSync(join(REPO_ROOT, "app/out/OutClient.tsx"), "utf8");
const outCss = readFileSync(join(REPO_ROOT, "app/out/out.css"), "utf8");

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

describe("the listings come before the lines about them", () => {
  it("renders both footnotes after the listing surface", () => {
    const surfaceAt = outClient.indexOf('className="outListingSurface"');
    const noticeAt = outClient.indexOf('data-testid="out-venue-match-notice"');
    const creditAt = outClient.indexOf('data-testid="out-listing-credit"');
    expect(surfaceAt).toBeGreaterThan(-1);
    expect(noticeAt).toBeGreaterThan(surfaceAt);
    expect(creditAt).toBeGreaterThan(surfaceAt);
  });

  it("keeps the read's own status lines above the listings", () => {
    const statusAt = outClient.indexOf("outStatusLines({ body, failed })");
    const surfaceAt = outClient.indexOf('className="outListingSurface"');
    expect(statusAt).toBeGreaterThan(-1);
    expect(statusAt).toBeLessThan(surfaceAt);
  });

  it("keeps the footnotes inside the listings section they are about", () => {
    const section = outClient.slice(
      outClient.indexOf('className="outListings"'),
      outClient.indexOf("<EditorialRail />"),
    );
    expect(section).toContain('data-testid="out-venue-match-notice"');
    expect(section).toContain('data-testid="out-listing-credit"');
  });
});

// The count of unmatched rows was the page. It cannot be, because those rows
// now render: the only page-level finding left is a match that never RAN.
describe("no count stands in place of the listings it counts", () => {
  it("keeps no lead role and no hidden-rows claim in the page", () => {
    expect(outClient).not.toContain('unmatchedNotice.role === "lead"');
    expect(outClient).not.toContain("data-role={unmatchedNotice.role}");
    expect(outClient).not.toContain("out-unmatched-notice");
  });

  it("renders the pub answer on every row, at a weight under the page's own copy", () => {
    expect(outClient).toContain("<OutListingPubPair row={row} />");
    const status = outCss.match(/\.outStatus \{[^}]*font-size:\s*([\d.]+)rem/);
    const footnote = outCss.match(
      /\.outListingUnmatchedLine \{[^}]*font-size:\s*([\d.]+)rem/,
    );
    expect(status).not.toBeNull();
    expect(footnote).not.toBeNull();
    expect(Number(footnote?.[1])).toBeLessThan(Number(status?.[1]));
  });

  it("leads with the first listing and keeps the map as the second door", () => {
    const primaryAt = outClient.indexOf("primary={");
    const secondaryAt = outClient.indexOf("secondary={");
    const primary = outClient.slice(primaryAt, secondaryAt);
    expect(primary).toContain("primaryListing");
    expect(primary.indexOf("primaryListing")).toBeLessThan(
      primary.indexOf("OUT_MAP_WAY"),
    );
    expect(outClient.slice(secondaryAt)).toContain("OUT_MAP_WAY");
  });
});

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
