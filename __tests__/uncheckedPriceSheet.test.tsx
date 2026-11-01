// CAPTAIN DECISION 9, 1 November 2026: a typed price WITHOUT a receipt photo is
// accepted. It saves and shows as "logged by @handle, not checked" with its
// date. It does NOT colour the pin until a receipt confirms it or a second,
// independent person confirms it (docs/plans/LAUNCH_PLAN_2026-11-01.md, ADR
// 0010's dated amendment).
//
// This file pins the two places a drinker meets the decision. (1) The pub's
// own drop list prints an unchecked price as a dated, named row on the neutral
// plaque: weaker in words, never in a colour of its own, because colour means
// the price band and never trust. (2) The Pint Drop composer offers the bill in
// one optional line and never blocks Log it for want of it.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  authedFetch: async () => new Response(JSON.stringify({ drops: {} }), { status: 200 }),
}));

import { SpillReceiptStep } from "@/components/map/composer/SpillReceiptStep";
import PintDropsList from "@/components/map/inspector/PintDropsList";
import { dropReceiptText, type DropWithPhotos } from "@/components/map/usePintDrops";
import {
  RECEIPT_OPTIONAL_LINE,
  RECEIPT_REQUIRED_LINE,
  UNCHECKED_RECEIPT_LINE,
} from "@/lib/pintDropReceipt";
import { ANON_HANDLE_LABEL } from "@/lib/pintDropShared";
import { uncheckedPriceLine } from "@/lib/venuePriceLane";
import type { Venue } from "@/lib/venues";

const VENUE = { id: "venue-1vle947", name: "The Sir Christopher Hatton" } as Venue;

function drop(overrides: Partial<DropWithPhotos> = {}): DropWithPhotos {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    venueId: VENUE.id,
    handle: "sam",
    drink: "Lager",
    priceGbp: 4.5,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: "2026-10-30T20:00:00.000Z",
    pintPhotoUrl: null,
    venuePhotoUrl: null,
    receiptPhotoUrl: null,
    ...overrides,
  };
}

function renderList(drops: DropWithPhotos[]): string {
  return renderToStaticMarkup(
    createElement(PintDropsList, {
      venue: VENUE,
      drops,
      lastTrainDecision: null,
      reportDrop: async () => undefined,
      withSummaries: new Map(),
    }),
  );
}

describe("the pub's own drop list", () => {
  it("prints an unchecked price as a dated row, logged by its drinker and not checked", () => {
    const html = renderList([drop({ priceEvidence: "unchecked" })]);
    expect(html).toContain('data-price-check="unchecked"');
    expect(html).toContain("Logged by @sam, not checked");
    // The day it was logged, in London time, as the trust pill prints a day.
    expect(html).toContain('<time dateTime="2026-10-30T20:00:00.000Z">30 Oct</time>');
    expect(html).toContain("£4.50");
  });

  it("gives an unchecked figure no band, and a billed one its band, as before", () => {
    const unchecked = renderList([drop({ priceEvidence: "unchecked" })]);
    expect(unchecked).not.toMatch(/priceBand-(cheap|average|expensive)/);
    const billed = renderList([drop({ priceEvidence: "receipt" })]);
    expect(billed).toMatch(/priceBand-(cheap|average|expensive)/);
    expect(billed).not.toContain("not checked");
    // A row written before 0218 states no evidence and reads as it always has.
    const legacy = renderList([drop()]);
    expect(legacy).toMatch(/priceBand-(cheap|average|expensive)/);
    expect(legacy).not.toContain("not checked");
  });

  it("names a withheld drinker the way every public surface does, never by a made-up handle", () => {
    expect(uncheckedPriceLine(ANON_HANDLE_LABEL)).toBe(`Logged by ${ANON_HANDLE_LABEL}, not checked`);
    expect(uncheckedPriceLine("")).toBe(`Logged by ${ANON_HANDLE_LABEL}, not checked`);
    expect(uncheckedPriceLine("@@sam")).toBe("Logged by @sam, not checked");
    const html = renderList([drop({ priceEvidence: "unchecked", handle: ANON_HANDLE_LABEL })]);
    expect(html).toContain(`Logged by ${ANON_HANDLE_LABEL}, not checked`);
  });

  it("says nothing about checking on a note with no price", () => {
    const html = renderList([drop({ priceGbp: null, passedDownNote: "Old local." })]);
    expect(html).not.toContain("not checked");
  });
});

describe("the composer's receipt after a typed price lands", () => {
  it("says once why the pin is quiet, unless the pass has something stronger to say", () => {
    expect(dropReceiptText(false, { status: "awaiting_second_drinker" }, "4.50", true)).toBe(
      `Cheers. Your Pint Drop is live. ${UNCHECKED_RECEIPT_LINE}`,
    );
    // A billed price keeps its old receipt exactly.
    expect(dropReceiptText(false, { status: "awaiting_second_drinker" }, "4.50", false)).toBe(
      "Cheers. Your Pint Drop is live.",
    );
    // Two typed prices that agree: the mint's own sentence wins.
    const confirmed = dropReceiptText(
      false,
      {
        status: "confirmed",
        confirmation: {
          confirmationId: "c-1",
          confirmedAt: "2026-11-01T20:00:00.000Z",
          basis: "second_reporter",
        },
        dropIds: ["a", "b"],
      },
      "4.50",
      true,
    );
    expect(confirmed).toContain("Confirmed.");
    expect(confirmed).not.toContain(UNCHECKED_RECEIPT_LINE);
  });
});

describe("the Pint Drop composer's bill step", () => {
  const props = {
    receiptPhoto: null,
    receiptInputRef: { current: null },
    pickPhoto: () => {},
    removePhoto: () => {},
  } as unknown as Parameters<typeof SpillReceiptStep>[0];

  it("offers the bill in one optional line, and never asks for it", () => {
    const html = renderToStaticMarkup(createElement(SpillReceiptStep, props));
    expect(html).toContain(RECEIPT_OPTIONAL_LINE);
    expect(html).not.toContain(RECEIPT_REQUIRED_LINE);
    // Log it is the form's one primary; an optional photo may not look like it.
    expect(html).not.toMatch(/spillCameraBtn primary/);
  });
});
