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

const NOW = Date.parse("2026-09-07T18:00:00.000Z");
const DEAL_DAY = "2026-09-07T08:43:37.191Z";
const EVENT_DAY = "2026-09-07T02:00:00.000Z";
const LAST_MONTH = "2026-08-22T03:00:00.000Z";

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
      now: NOW,
    });
    expect(observed).toBe(EVENT_DAY);
    expect(checkedLabel(observed)).not.toBe("No date on this yet");
  });

  it("refuses a read too old to be about tonight", () => {
    // The 6 September defect: a quiet night dated "Checked 22 Aug". Evidence
    // older than a day cannot say what is on tonight.
    expect(
      tonightWhatsOnObservedAt({
        renderedGroups: [],
        outEvents: [],
        kindObservedAt: { event: LAST_MONTH },
        now: NOW,
      }),
    ).toBeNull();
  });

  it("claims no What's-On day when every row on screen came from Out", () => {
    const fromOut = whatsOnRow("music", DEAL_DAY);
    expect(
      tonightWhatsOnObservedAt({
        renderedGroups: [group(fromOut)],
        outEvents: [fromOut],
        kindObservedAt: { deal: DEAL_DAY, music: DEAL_DAY },
        now: NOW,
      }),
    ).toBeNull();
  });

  it("still answers undated when the read dated nothing at all", () => {
    expect(
      tonightWhatsOnObservedAt({
        renderedGroups: [],
        outEvents: [],
        kindObservedAt: {},
        now: NOW,
      }),
    ).toBeNull();
  });

  it("dates a night with rows from the kinds on screen, not the whole read", () => {
    const observed = tonightWhatsOnObservedAt({
      renderedGroups: [group(whatsOnRow("deal", DEAL_DAY))],
      outEvents: [],
      kindObservedAt: { deal: DEAL_DAY, event: EVENT_DAY },
      now: NOW,
    });
    expect(observed).toBe(DEAL_DAY);
  });

  it("keeps a rendered kind the read could not date undated", () => {
    const observed = tonightWhatsOnObservedAt({
      renderedGroups: [group(whatsOnRow("quiz", DEAL_DAY))],
      outEvents: [],
      kindObservedAt: { deal: DEAL_DAY },
      now: NOW,
    });
    expect(observed).toBeNull();
  });
});
