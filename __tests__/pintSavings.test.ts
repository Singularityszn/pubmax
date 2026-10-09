import { describe, expect, it } from "vitest";

import {
  MIN_SAVINGS_SAMPLE,
  pintPriceAverages,
  readerSavingLine,
  readerSavings,
  savingPerPintGbp,
  strangerSavingLine,
} from "@/lib/pintSavings";
import { getPricedVenues } from "@/lib/venuePriceIndex";

// The landing prints a figure in pounds, so the figure is MEASURED here rather
// than typed into the copy. This test is the measurement: it reads the shipped
// price dataset, takes the two means the rule names, and holds the gap between
// them. A re-collected dataset moves the sentence and this test with it; it can
// never leave a stale claim standing on the front door.

describe("what the cheap pub is worth", () => {
  it("refuses a figure when the dataset is too small to mean one", () => {
    const thin = Array.from({ length: MIN_SAVINGS_SAMPLE - 1 }, () => 5);
    expect(pintPriceAverages(thin)).toBeNull();
    expect(strangerSavingLine(null)).toBeNull();
  });

  it("takes the mean over all prices and over the cheapest third", () => {
    // Thirty prices, £1 to £30. The mean is £15.50; the cheapest ten average £5.50.
    const prices = Array.from({ length: 30 }, (_, index) => index + 1);
    const averages = pintPriceAverages(prices);
    expect(averages).toEqual({ averageGbp: 15.5, cheapAverageGbp: 5.5, sampleSize: 30 });
    expect(savingPerPintGbp(averages!)).toBe(10);
  });

  it("counts a reader's own logged prices only where they beat the average", () => {
    const averages = { averageGbp: 6, cheapAverageGbp: 4.5, sampleSize: 100 };
    const savings = readerSavings(
      [{ priceGbp: 4.5 }, { priceGbp: 5 }, { priceGbp: 6 }, { priceGbp: 7.2 }],
      averages,
    );
    expect(savings).toEqual({ pints: 2, savedGbp: 2.5 });
    expect(readerSavingLine(savings)).toBe(
      "You've kept £2.50 over 2 pints you logged under the London average.",
    );
    // A reader who has logged nothing under the average is told nothing, never
    // a counter sitting at zero.
    expect(readerSavingLine(readerSavings([{ priceGbp: 8 }], averages))).toBeNull();
  });

  it("measures the London gap from the shipped dataset", async () => {
    const venues = await getPricedVenues();
    const prices = venues.flatMap((venue) =>
      typeof venue.cheapestPrice === "number" ? [venue.cheapestPrice] : [],
    );
    const averages = pintPriceAverages(prices);
    expect(averages, "the shipped dataset backs a figure").toBeTruthy();
    const gap = savingPerPintGbp(averages!);
    // The measurement itself. Both means are real prices somebody pays, and the
    // gap is what the landing is allowed to claim per pint.
    expect(averages!.sampleSize).toBeGreaterThan(500);
    expect(averages!.cheapAverageGbp).toBeLessThan(averages!.averageGbp);
    expect(gap).toBeGreaterThan(0.5);
    expect(gap).toBeLessThan(4);
    const line = strangerSavingLine(averages);
    expect(line).toContain(`${gap.toFixed(2)} a pint you keep`);
    expect(line).not.toContain("!");
  });
});
