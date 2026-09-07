import { describe, expect, it } from "vitest";

import { tonightWhatsOnObservedAt } from "@/lib/tonightOutListings";
import type { TonightGroupedRow } from "@/lib/tonightListGrouping";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { checkedLabel } from "@/lib/whatsOnBadges";

/**
 * A quiet night was checked, and the chip says when.
 *
 * Grok read the 7 September deploy and found "Quiet night · No date on this
 * yet · via what's-on" over a read that had just served 96 Wetherspoon deals
 * and 24 Ticketmaster events and dated every one of them. Nothing about that
 * night was undated: the rows were refused from the lede, which is a decision
 * of ours rather than an absence of evidence.
 */

const DEAL_DAY = "2026-09-07T08:43:37.191Z";
const EVENT_DAY = "2026-09-06T21:00:00.000Z";

function group(row: WhatsOnRow): TonightGroupedRow {
  return { row, venueCount: 1, alternates: [] } as TonightGroupedRow;
}

function whatsOnRow(kind: WhatsOnRow["kind"], observedAt: string): WhatsOnRow {
  return {
    id: `row-${kind}`,
    venueId: "venue-independent",
    placeName: "The Test Arms",
    kind,
    startsAt: "2026-09-07T20:00:00.000Z",
    title: "Listing",
    source: { label: "The Test Arms", url: "https://example.com/listing" },
    observedAt,
    confidence: "listed",
  } as WhatsOnRow;
}

describe("the quiet night's own date", () => {
  it("dates a quiet night from the read that produced it", () => {
    const observed = tonightWhatsOnObservedAt({
      renderedGroups: [],
      outEvents: [],
      kindObservedAt: { deal: DEAL_DAY, event: EVENT_DAY },
    });
    expect(observed).toBe(EVENT_DAY);
    expect(checkedLabel(observed)).not.toBe("No date on this yet");
  });

  it("still answers undated when the read dated nothing at all", () => {
    expect(
      tonightWhatsOnObservedAt({ renderedGroups: [], outEvents: [], kindObservedAt: {} }),
    ).toBeNull();
  });

  it("dates a night with rows from the kinds on screen, not the whole read", () => {
    const observed = tonightWhatsOnObservedAt({
      renderedGroups: [group(whatsOnRow("deal", DEAL_DAY))],
      outEvents: [],
      kindObservedAt: { deal: DEAL_DAY, event: EVENT_DAY },
    });
    expect(observed).toBe(DEAL_DAY);
  });

  it("keeps a rendered kind the read could not date undated", () => {
    const observed = tonightWhatsOnObservedAt({
      renderedGroups: [group(whatsOnRow("quiz", DEAL_DAY))],
      outEvents: [],
      kindObservedAt: { deal: DEAL_DAY },
    });
    expect(observed).toBeNull();
  });
});
