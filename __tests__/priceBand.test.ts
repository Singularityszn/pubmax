import { describe, expect, it } from "vitest";

import {
  MIN_PRICE_BAND_SAMPLE,
  PRICE_BANDS,
  PRICE_BAND_TOKEN,
  priceBand,
  priceBandBasisFor,
  priceBandBucket,
  priceBandClass,
  priceBandFromBucket,
  priceBandLabel,
  priceBandLegendLabel,
  priceBandNote,
  priceBandThresholdsFor,
  priceBandThresholdsFrom,
  priceBandAreaForVenue,
  priceBandBasisNoun,
} from "@/lib/priceBand";
import { buildPriceBandTable, readCityPintPrices } from "../scripts/build_price_bands.mjs";
import thresholdsTable from "@/public/data/price_bands/thresholds.json";

// Captain's law (2026-09-05): RED means expensive, YELLOW means affordable and
// average, GREEN means cheap. lib/priceBand.ts is the ONE rule, and this file
// holds the rule, the shipped table and the tokens to each other.

const ROOT = process.cwd();
const LONDON = { city: "london" } as const;

describe("the tercile rule", () => {
  it("cuts a sorted list into thirds at prices somebody pays, nothing interpolated", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 3 + i * 0.1);
    const t = priceBandThresholdsFrom(prices);
    expect(t).not.toBeNull();
    // 30 rows: index floor(29/3) = 9 and floor(58/3) = 19.
    expect(t?.cheapMaxGbp).toBeCloseTo(3.9, 5);
    expect(t?.averageMaxGbp).toBeCloseTo(4.9, 5);
    expect(t?.sampleSize).toBe(30);
    expect(prices).toContain(t!.cheapMaxGbp);
  });

  it("answers null under the sample floor, so one row and an empty list cut nothing", () => {
    expect(priceBandThresholdsFrom([])).toBeNull();
    expect(priceBandThresholdsFrom([5.5])).toBeNull();
    expect(priceBandThresholdsFrom(Array(MIN_PRICE_BAND_SAMPLE - 1).fill(5))).toBeNull();
    expect(priceBandThresholdsFrom(Array(MIN_PRICE_BAND_SAMPLE).fill(5))).not.toBeNull();
  });

  it("drops a non-finite or non-positive price, because £0 is a missing figure", () => {
    const prices = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, ...Array(30).fill(4)];
    expect(priceBandThresholdsFrom(prices)?.sampleSize).toBe(30);
  });

  it("still bands when every price is the same: cheap up to it, expensive above", () => {
    const t = priceBandThresholdsFrom(Array(40).fill(5))!;
    expect(t.cheapMaxGbp).toBe(5);
    expect(t.averageMaxGbp).toBe(5);
  });
});

describe("the band a figure wears", () => {
  const { cheapMaxGbp, averageMaxGbp } = priceBandThresholdsFor(LONDON);

  it("puts a boundary price in the lower band and a penny more in the next", () => {
    expect(priceBand(cheapMaxGbp, LONDON)).toBe("cheap");
    expect(priceBand(cheapMaxGbp + 0.01, LONDON)).toBe("average");
    expect(priceBand(averageMaxGbp, LONDON)).toBe("average");
    expect(priceBand(averageMaxGbp + 0.01, LONDON)).toBe("expensive");
  });

  it("reads the captain's example: a £6.50 London pint is expensive, red", () => {
    expect(priceBand(6.5, LONDON)).toBe("expensive");
    expect(priceBandBucket(6.5, LONDON)).toBe(2);
    expect(PRICE_BAND_TOKEN.expensive).toBe("--price-band-expensive");
  });

  it("wears no band for no figure", () => {
    for (const value of [null, undefined, Number.NaN, 0, -3]) {
      expect(priceBand(value, LONDON)).toBeNull();
      expect(priceBandBucket(value, LONDON)).toBe(3);
      expect(priceBandClass(priceBand(value, LONDON))).toBe("");
    }
  });

  it("takes the dataset thresholds for a missing, unknown or thin area, and says so", () => {
    expect(priceBandBasisFor(undefined).basis).toBe("all");
    expect(priceBandBasisFor(null).basis).toBe("all");
    expect(priceBandBasisFor({ city: null }).basis).toBe("all");
    expect(priceBandBasisFor({ city: "atlantis" }).basis).toBe("all");
    // A city pack below the sample floor has no terciles of its own.
    expect(priceBandBasisFor({ city: "manchester" }).basis).toBe("all");
    expect(priceBandBasisFor(LONDON).basis).toBe("city");
    expect(priceBandBasisFor({ city: " London " }).basis).toBe("city");
    expect(priceBand(6.5)).toBe(priceBand(6.5, { city: "manchester" }));
  });

  it("resolves a venue id to its city, and a London id to London", () => {
    expect(priceBandAreaForVenue("venue-1vle947")).toEqual({ city: "london" });
    expect(priceBandAreaForVenue("venue-mcr-iy010v")).toEqual({ city: "manchester" });
    expect(priceBandAreaForVenue(null)).toBeNull();
    expect(priceBandAreaForVenue("")).toBeNull();
  });

  it("round-trips the map's numeric buckets", () => {
    expect(PRICE_BANDS.map((band) => priceBandFromBucket(priceBandBucket(band === "cheap" ? cheapMaxGbp : band === "average" ? averageMaxGbp : averageMaxGbp + 1, LONDON)))).toEqual(PRICE_BANDS);
    expect(priceBandFromBucket(3)).toBeNull();
    expect(priceBandFromBucket(-1)).toBeNull();
  });

  it("names every band once, and prints the thresholds it was cut at", () => {
    expect(PRICE_BANDS.map(priceBandLabel)).toEqual(["Cheap", "Average", "Expensive"]);
    expect(PRICE_BANDS.map(priceBandClass)).toEqual([
      "priceBand-cheap",
      "priceBand-average",
      "priceBand-expensive",
    ]);
    expect(priceBandLegendLabel("cheap", LONDON)).toBe("£5.25 or less");
    expect(priceBandLegendLabel("average", LONDON)).toBe("Over £5.25, up to £6.20");
    expect(priceBandLegendLabel("expensive", LONDON)).toBe("Over £6.20");
    expect(priceBandNote("expensive", LONDON)).toContain(
      `dearest third of ${thresholdsTable.cities.london.sampleSize} priced pubs`,
    );
  });
});

describe("whose terciles a figure was cut against (F-21)", () => {
  // `basis` was returned and read by nothing, so a Manchester or Bristol figure
  // was coloured against London's £5.15/£6.15 and the note called them the
  // reader's own. Every city outside London remains below the sample floor,
  // so this path covers all of them, plus the national base layer.
  const MANCHESTER_ID = "venue-mcr-abc12";
  const BASE_ID = "venue-uk-n251829660";
  const LONDON_ID = "venue-xjf3n0";

  it("never labels a national base pub a London one", () => {
    // `venue-uk-…` carries no three-letter city prefix, so the old fallback
    // called every unpriced pub in the country London.
    expect(priceBandAreaForVenue(BASE_ID)).toEqual({ city: null });
    expect(priceBandAreaForVenue(LONDON_ID)).toEqual({ city: "london" });
    expect(priceBandAreaForVenue(MANCHESTER_ID)).toEqual({ city: "manchester" });
  });

  it("reads the whole dataset for a city with no terciles of its own", () => {
    expect(priceBandBasisFor(priceBandAreaForVenue(MANCHESTER_ID)).basis).toBe("all");
    expect(priceBandBasisFor(priceBandAreaForVenue(BASE_ID)).basis).toBe("all");
    expect(priceBandBasisFor(priceBandAreaForVenue(LONDON_ID)).basis).toBe("city");
  });

  it("says so in the note rather than implying the pub's own city", () => {
    for (const id of [MANCHESTER_ID, BASE_ID]) {
      const area = priceBandAreaForVenue(id);
      expect(priceBandBasisNoun(area)).toBe("priced pubs across every city we hold");
      expect(priceBandNote("cheap", area)).toContain(
        "priced pubs across every city we hold",
      );
    }
    // London's own terciles keep the plain noun: they ARE the city's.
    const london = priceBandAreaForVenue(LONDON_ID);
    expect(priceBandBasisNoun(london)).toBe("priced pubs");
    expect(priceBandNote("cheap", london)).not.toContain("every city we hold");
  });

  it("still paints a band, because the dataset is the honest fallback", () => {
    // Removing the colour from every non-London pub would be a bigger claim
    // than the finding supports: the thresholds are real prices somebody pays,
    // and the note names the whole dataset as the comparison.
    expect(priceBand(4, priceBandAreaForVenue(MANCHESTER_ID))).toBe("cheap");
    expect(priceBand(9, priceBandAreaForVenue(BASE_ID))).toBe("expensive");
  });
});

describe("the shipped thresholds table", () => {
  it("is what the packs on disk cut to today, so a re-collection cannot leave it stale", async () => {
    const rebuilt = buildPriceBandTable(await readCityPintPrices(ROOT));
    expect(thresholdsTable).toEqual(rebuilt);
  });

  it("holds London's own basis and no other city's, ALARMING when a second city qualifies", () => {
    // A city earning its own terciles is good news, and the copy that says
    // "prices compared across London" has to be revisited in the same commit.
    expect(Object.keys(thresholdsTable.cities)).toEqual(["london"]);
    expect(thresholdsTable.all.sampleSize).toBeGreaterThan(thresholdsTable.cities.london.sampleSize);
    expect(thresholdsTable.minSample).toBe(MIN_PRICE_BAND_SAMPLE);
    expect(thresholdsTable.all.sampleSize).toBeGreaterThanOrEqual(MIN_PRICE_BAND_SAMPLE);
  });
});

