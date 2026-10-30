import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TonightProvenanceLines from "@/app/tonight/TonightProvenanceLines";
import { groupTonightListings } from "@/lib/tonightListGrouping";
import {
  mergeTonightListingRows,
  tonightProvenanceCredits,
  tonightWhatsOnObservedAt,
  type TonightOutAnswer,
} from "@/lib/tonightOutListings";
import { matchVenueId, type WhatsOnKindObservedAt, type WhatsOnRow } from "@/lib/whatsOn";
import { checkedLabel } from "@/lib/whatsOnBadges";
import { mapThingsToDoToRows } from "@/lib/whatsOnCitymcp";

const now = Date.parse("2026-10-25T12:00:00Z");
const listing: WhatsOnRow = {
  id: "cask-bluegrass", venueId: "venue-pzbwmw", placeName: "Cask", kind: "music",
  title: "Bluegrass", startsAt: "2026-10-25T16:30:00Z", confidence: "listed",
  observedAt: "2026-10-07T12:00:00Z",
  source: { label: "Cask", url: "https://example.com/bluegrass" },
};

function render(
  rows: WhatsOnRow[],
  kindObservedAt: WhatsOnKindObservedAt = {},
  out: TonightOutAnswer = { body: null, failed: true, pending: false },
) {
  const renderedGroups = groupTonightListings(
    mergeTonightListingRows(rows, out.body?.events ?? [], now), null,
  );
  const observedAt = tonightWhatsOnObservedAt({
    renderedGroups, outEvents: out.body?.events ?? [], kindObservedAt, now,
  });
  return renderToStaticMarkup(createElement(TonightProvenanceLines, {
    nearestSuffix: null,
    provenance: tonightProvenanceCredits({
      renderedGroups, whatsOnRows: rows, whatsOnChecked: observedAt ? checkedLabel(observedAt) : null, now, out,
    }),
  }));
}

describe("Tonight source explanations", () => {
  it("explains a stale pub listing without presenting it as confirmed tonight", () => {
    const html = render([listing]);
    expect(html).toContain("1 pub listing hidden: its source check is older than 24 hours.");
    expect(html).not.toContain("The what’s-on source check date is not recorded.");
    expect(html).not.toContain("Checked 25 Oct");
  });

  it("counts only current pub listings excluded by the source freshness rule", () => {
    const html = render([
      listing, listing,
      { ...listing, id: "fresh", venueId: "venue-fresh", observedAt: "2026-10-24T12:00:00Z" },
      { ...listing, id: "past", startsAt: "2026-10-24T10:00:00Z" },
      { ...listing, id: "unmatched", venueId: undefined },
      { ...listing, id: "deal", kind: "deal" },
    ]);
    expect(html).toContain("1 pub listing hidden:");
    expect(html).not.toContain("2 pub listings hidden:");
  });

  it("counts distinct stale and undated listings separately", () => {
    const html = render([
      listing,
      { ...listing, id: "second", venueId: "venue-second", title: "Folk night", placeName: "Another pub" },
      { ...listing, id: "undated", venueId: "venue-third", title: "Jazz", observedAt: "" },
    ]);
    expect(html).toContain("2 pub listings hidden: their source checks are older than 24 hours.");
    expect(html).toContain("1 pub listing hidden: its source check date is not recorded.");
  });

  it("keeps an old what’s-on check separate from a dated Ticketmaster read", () => {
    const html = renderToStaticMarkup(createElement(TonightProvenanceLines, {
      nearestSuffix: null,
      provenance: tonightProvenanceCredits({
        renderedGroups: [], whatsOnRows: [listing], whatsOnChecked: null, now,
        out: {
          body: { status: "ready", venueMatch: "ready", events: [],
            observedAt: { ticketmaster: "2026-10-25T11:00:00Z" } },
          failed: false, pending: false,
        },
      }),
    }));
    expect(html).toContain("1 pub listing hidden: its source check is older than 24 hours.");
    expect(html).not.toContain("The what’s-on source check date is not recorded.");
    expect(html).toContain("No pub-matched events via Ticketmaster · Checked 25 Oct");
    expect(html).not.toContain("The live listings source check date is not recorded.");
  });

  // Live walk F6 (30 Oct) read this pair as a contradiction. Each feed needs
  // its own date: a Ticketmaster check does not date the what's-on read, so
  // the what's-on notice stays beside the dated Ticketmaster line.
  it("keeps the what's-on missing-date notice beside a dated empty Ticketmaster read", () => {
    const html = renderToStaticMarkup(createElement(TonightProvenanceLines, {
      nearestSuffix: null,
      provenance: tonightProvenanceCredits({
        renderedGroups: [], whatsOnRows: [], whatsOnChecked: null, pubSuggestionCount: 3, now,
        out: {
          body: { status: "ready", venueMatch: "ready", events: [],
            observedAt: { ticketmaster: "2026-10-25T11:00:00Z" } },
          failed: false, pending: false,
        },
      }),
    }));
    expect(html).toContain("No pub-matched events · via what’s-on");
    expect(html).toContain("No pub-matched events via Ticketmaster · Checked 25 Oct");
    expect(html).toContain("The what’s-on source check date is not recorded.");
    expect(html).not.toContain("The live listings source check date is not recorded.");
  });

  it("distinguishes an absent row date from an old row date", () => {
    expect(render([{ ...listing, observedAt: "" }])).toContain(
      "1 pub listing hidden: its source check date is not recorded.",
    );
    expect(render([{ ...listing, observedAt: "2026-10-25T11:00:00Z" }])).not.toContain("hidden:");
  });

  it("keeps a displayed undated CityMCP deal's notice beside an unrelated stale exclusion", () => {
    const deals = mapThingsToDoToRows({
      window: "tonight",
      opportunities: [{
        title: "Sunday food offer", kind: "food_drink", startsAt: "2026-10-25T16:30:00Z",
        place: { name: "The Dove" },
        source: { label: "The Dove", url: "https://example.com/sunday-food" },
      }],
    }, { now }).map((row) => matchVenueId(row, () => "venue-the-dove"));
    expect(deals).toHaveLength(1);
    expect(mergeTonightListingRows([listing, ...deals], [], now)).toEqual(deals);
    const html = render([listing, ...deals], {}, {
      body: { status: "ready", venueMatch: "ready", events: [],
        observedAt: { ticketmaster: "2026-10-25T11:00:00Z" } },
      failed: false, pending: false,
    });
    expect(html).toContain("1 listing · via what’s-on");
    expect(html).toContain("The what’s-on source check date is not recorded.");
    expect(html).toContain("1 pub listing hidden: its source check is older than 24 hours.");
    expect(html).toContain("No pub-matched events via Ticketmaster · Checked 25 Oct");
    expect(html).not.toContain("The live listings source check date is not recorded.");
    expect(html).not.toContain("1 listing · Checked 25 Oct · via what’s-on");
  });

  it.each(["2026-10-07T12:00:00Z", "", "not-a-date"])(
    "does not count an accepted listing's rejected duplicate as hidden: %s", (observedAt) => {
      const rejected = { ...listing, observedAt };
      const fresh = { ...listing, observedAt: "2026-10-25T11:00:00Z" };
      for (const rows of [[rejected, fresh], [fresh, rejected]]) {
        expect(mergeTonightListingRows(rows, [], now)).toEqual([fresh]);
        const html = render(rows, { music: fresh.observedAt });
        expect(html).toContain("1 listing · Checked 25 Oct · via what’s-on");
        expect(html).not.toContain("hidden:");
        expect(html).not.toContain("The what’s-on source check date is not recorded.");
      }
    },
  );

  it("does not count a stale duplicate of a displayed Out listing as hidden", () => {
    const fresh = { ...listing, observedAt: "2026-10-25T11:00:00Z",
      source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" } };
    const html = render([listing], {}, {
      body: { status: "ready", venueMatch: "ready", events: [fresh],
        observedAt: { ticketmaster: fresh.observedAt } },
      failed: false, pending: false,
    });
    expect(html).toContain("1 listing via Ticketmaster · Checked 25 Oct");
    expect(html).not.toContain("hidden:");
    expect(html).not.toContain("via what’s-on");
  });

  it("keeps a displayed dated listing dated beside an unrelated stale exclusion", () => {
    const fresh = { ...listing, venueId: "venue-the-dove", observedAt: "2026-10-25T11:00:00Z" };
    const html = render([listing, fresh], { music: fresh.observedAt });
    expect(html).toContain("1 listing · Checked 25 Oct · via what’s-on");
    expect(html).toContain("1 pub listing hidden: its source check is older than 24 hours.");
    expect(html).not.toContain("The what’s-on source check date is not recorded.");
  });
});
