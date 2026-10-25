import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TonightProvenanceLines from "@/app/tonight/TonightProvenanceLines";
import { tonightProvenanceCredits } from "@/lib/tonightOutListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

const now = Date.parse("2026-10-25T12:00:00Z");
const listing: WhatsOnRow = {
  id: "cask-bluegrass", venueId: "venue-pzbwmw", placeName: "Cask", kind: "music",
  title: "Bluegrass", startsAt: "2026-10-25T16:30:00Z", confidence: "listed",
  observedAt: "2026-10-07T12:00:00Z",
  source: { label: "Cask", url: "https://example.com/bluegrass" },
};

function render(rows: WhatsOnRow[]) {
  return renderToStaticMarkup(createElement(TonightProvenanceLines, {
    nearestSuffix: null,
    provenance: tonightProvenanceCredits({
      renderedGroups: [], whatsOnRows: rows, whatsOnChecked: null, now,
      out: { body: null, failed: true, pending: false },
    }),
  }));
}

describe("Tonight source explanations", () => {
  it("explains a stale pub listing without presenting it as confirmed tonight", () => {
    const html = render([listing]);
    expect(html).toContain("1 pub listing hidden: its source check is older than 24 hours.");
    expect(html).toContain("The what’s-on source check date is not recorded.");
    expect(html).not.toContain("Checked 25 Oct");
  });

  it("counts only current pub listings excluded by the source freshness rule", () => {
    const html = render([
      listing, listing,
      { ...listing, id: "fresh", observedAt: "2026-10-24T12:00:00Z" },
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

  it("keeps the missing what’s-on date separate from a dated Ticketmaster read", () => {
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
    expect(html).toContain("The what’s-on source check date is not recorded.");
    expect(html).toContain("No pub-matched events via Ticketmaster · Checked 25 Oct");
    expect(html).not.toContain("The live listings source check date is not recorded.");
  });

  it("distinguishes an absent row date from an old row date", () => {
    expect(render([{ ...listing, observedAt: "" }])).toContain(
      "1 pub listing hidden: its source check date is not recorded.",
    );
    expect(render([{ ...listing, observedAt: "2026-10-25T11:00:00Z" }])).not.toContain("hidden:");
  });
});
