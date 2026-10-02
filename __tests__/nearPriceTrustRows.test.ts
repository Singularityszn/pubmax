import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NearMeCardList } from "@/components/nearme/NearMeNow";
import { isoDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import type { NearMeCard } from "@/lib/nearMeAnswer";
import { NEAR_PRICE_TRUST_CAPTION, type NearPriceTrustResponse } from "@/lib/nearPriceTrust";

const CARDS: NearMeCard[] = [
  {
    id: "venue-a",
    name: "The First Pint",
    borough: "Westminster",
    cheapestPrice: 3.25,
    distanceKm: 0.2,
    walkMinutes: 3,
  },
  {
    id: "venue-b",
    name: "The Second Pint",
    borough: "Camden",
    cheapestPrice: 4.5,
    distanceKm: 0.4,
    walkMinutes: 5,
  },
];

function render(priceTrust: "loading" | NearPriceTrustResponse): string {
  return renderToStaticMarkup(
    createElement(NearMeCardList, {
      cards: CARDS,
      onOpen: () => undefined,
      priceTrust,
    }),
  );
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("/near price trust rows", () => {
  it("keeps useful prices visible while publisher evidence loads", () => {
    const markup = render("loading");

    expect(markup).toContain("£3.25");
    expect(markup).toContain("£4.50");
    expect(occurrences(markup, "On record · Checking publisher")).toBe(2);
  });

  it("shows named and honestly unrecorded publishers", () => {
    const markup = render({
      status: "ready",
      collectedAt: isoDate(PINT_DATASET_OBSERVED_AT),
      results: [
        { venueId: "venue-a", price: 3.25, publisher: "Pint Prices", observedAt: null },
        { venueId: "venue-b", price: 4.5, publisher: null, observedAt: null },
      ],
    });

    expect(markup).toContain("On record · Pint Prices");
    expect(markup).toContain("On record · Publisher not recorded");
    expect(occurrences(markup, NEAR_PRICE_TRUST_CAPTION)).toBe(1);
  });

  it("does not attach evidence to a card when its price has changed", () => {
    const markup = render({
      status: "ready",
      collectedAt: isoDate(PINT_DATASET_OBSERVED_AT),
      results: [
        { venueId: "venue-a", price: 9.99, publisher: "Wrong price publisher", observedAt: null },
        { venueId: "venue-b", price: 4.5, publisher: null, observedAt: null },
      ],
    });

    expect(markup).toContain("£3.25");
    expect(markup).not.toContain("Wrong price publisher");
    expect(markup).toContain("On record · Publisher could not be checked");
  });

  it("keeps a failed read distinct from an unrecorded publisher", () => {
    const markup = render({
      status: "degraded",
      collectedAt: isoDate(PINT_DATASET_OBSERVED_AT),
      results: [],
    });

    expect(occurrences(markup, "On record · Publisher could not be checked")).toBe(2);
    expect(markup).not.toContain("Publisher not recorded");
  });

  it("keeps matching publisher evidence in a mixed degraded response", () => {
    const markup = render({
      status: "degraded",
      collectedAt: isoDate(PINT_DATASET_OBSERVED_AT),
      results: [
        { venueId: "venue-a", price: 3.25, publisher: "Pint Prices", observedAt: null },
      ],
    });

    expect(markup).toContain("On record · Pint Prices");
    expect(occurrences(markup, "On record · Publisher could not be checked")).toBe(1);
  });

  it("dates each card by its own row's read, and an unread row by nothing", () => {
    const markup = render({
      status: "ready",
      collectedAt: isoDate(PINT_DATASET_OBSERVED_AT),
      results: [
        { venueId: "venue-a", price: 3.25, publisher: "Pint Prices", observedAt: "2026-07-03T23:10:47.000Z" },
        { venueId: "venue-b", price: 4.5, publisher: null, observedAt: null },
      ],
    });

    expect(markup).toContain("On record · Pint Prices · read 4 Jul");
    expect(markup).toContain("On record · Publisher not recorded<");
    expect(markup).not.toContain("read 2 Oct");
    expect(markup).not.toContain("Prices last collected");
  });

  it("captions the list with the dataset stamp instead of an arbitrary response date", () => {
    const markup = render({
      status: "ready",
      collectedAt: "2026-07-04",
      results: [{ venueId: "venue-a", price: 3.25, publisher: "Pint Prices", observedAt: null }],
    });

    expect(markup).toContain(NEAR_PRICE_TRUST_CAPTION);
    expect(markup).not.toContain("4 Jul");
  });
});
