import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import TodayPintsCard from "@/app/today/TodayPintsCard";
import PintIndexArrival from "@/components/pintindex/PintIndexArrival";
import {
  formatPintDatasetAsOf,
  formatPintDatasetSnapshot,
  PINT_DATASET_OBSERVED_AT,
} from "@/lib/dataFreshness";
import { CENTRAL_PATCH } from "@/lib/nightPatches";

const ROOT = join(__dirname, "..");

describe("public pint-price clock", () => {
  it("separates Today's baseline collection date from the Pint Index as-of clock", () => {
    const drinkOverlay = JSON.parse(
      readFileSync(
        join(ROOT, "public", "data", "drink_price_updates", "latest.json"),
        "utf8",
      ),
    ) as { generatedAt: string };
    // TWO CLOCKS, and the point is that they are separate rather than ordered.
    // The reviewed drink overlay and the hand-collected bundle move on their
    // own cadences, so which one is fresher flips with every re-collection; an
    // ordering assertion here would fail on an honest bundle refresh while
    // saying nothing about the claim under test.
    expect(Date.parse(drinkOverlay.generatedAt)).not.toBe(
      PINT_DATASET_OBSERVED_AT.getTime(),
    );

    // Both surfaces name the same bundle as a SNAPSHOT, in the sentence each
    // one needs: Today's caption stands alone, the Pint Index clause sits
    // inside a sentence. Neither may borrow the other's wording.
    const asOf = formatPintDatasetAsOf();
    const snapshotCaption = formatPintDatasetSnapshot();
    const todayHtml = renderToStaticMarkup(
      createElement(TodayPintsCard, {
        index: {
          [CENTRAL_PATCH.id]: {
            patchId: CENTRAL_PATCH.id,
            areaName: "Piccadilly & Soho",
            rows: [{
              id: "test-pub",
              name: "The Test Arms",
              price: 4.8,
              priceLabel: "£4.80",
              mapHref: "/map?venue=test-pub",
              areaRelation: "inside" as const,
            }],
          },
        },
      }),
    );
    const pintIndexHtml = renderToStaticMarkup(
      createElement(PintIndexArrival, {
        areas: [{
          slug: "camden",
          name: "Camden",
          pricedCount: 12,
          cheapestGbp: 4.5,
          cheapestVenueId: "venue-camden",
        }],
        surface: "index",
      }),
    );

    expect(todayHtml).toContain(snapshotCaption);
    expect(todayHtml).not.toContain(asOf);
    expect(pintIndexHtml).toContain(asOf);
    expect(pintIndexHtml).not.toContain(snapshotCaption);

    // Neither surface may call a months-old bundle a collection that just
    // happened, which is what "Last collected" read as.
    expect(todayHtml).not.toContain("Last collected");
    expect(pintIndexHtml).not.toContain("Last collected");
  });

  // The card carried the claim TWICE: the dated caption at the top, then a
  // near-identical undated sentence at the foot naming a different geography.
  // A reader met the same claim twice and only one copy said which day it came
  // from, so the dated one is the only one that stays.
  it("says what these prices are exactly once, and dates it", () => {
    const html = renderToStaticMarkup(
      createElement(TodayPintsCard, {
        index: {
          [CENTRAL_PATCH.id]: {
            patchId: CENTRAL_PATCH.id,
            areaName: "Piccadilly & Soho",
            rows: [{
              id: "test-pub",
              name: "The Test Arms",
              price: 4.8,
              priceLabel: "£4.80",
              mapHref: "/map?venue=test-pub",
              areaRelation: "inside" as const,
            }],
          },
        },
      }),
    );

    expect(html.split("Lowest listed prices")).toHaveLength(2);
    expect(html).toContain(
      `Lowest listed prices in central London. ${formatPintDatasetSnapshot()}.`,
    );
    expect(html).not.toContain("Lowest listed prices in Piccadilly &amp; Soho.");
    // The way onward out of the card is untouched.
    expect(html).toContain("Change area");
  });
});
