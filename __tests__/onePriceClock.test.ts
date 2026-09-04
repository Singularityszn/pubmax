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
    expect(Date.parse(drinkOverlay.generatedAt)).toBeGreaterThan(
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
});
