import { readFileSync } from "node:fs";
import { join } from "node:path";

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
import { defined } from "@/__tests__/helpers/defined";

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
    // A city pack with no priced pubs has no terciles of its own.
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
    expect(priceBandLegendLabel("cheap", LONDON)).toBe("£5.20 or less");
    expect(priceBandLegendLabel("average", LONDON)).toBe("Over £5.20, up to £6.15");
    expect(priceBandLegendLabel("expensive", LONDON)).toBe("Over £6.15");
    expect(priceBandNote("expensive", LONDON)).toContain("dearest third of 950 priced pubs");
  });
});

describe("whose terciles a figure was cut against (F-21)", () => {
  // `basis` was returned and read by nothing, so a Manchester or Bristol figure
  // was coloured against London's £5.15/£6.15 and the note called them the
  // reader's own. Every city outside London ships `sampleSize: 0` today, so
  // this is not a rare path: it is all of them, plus the national base layer.
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
    // and today every one of them is a London price, which the note now says.
    expect(priceBand(4, priceBandAreaForVenue(MANCHESTER_ID))).toBe("cheap");
    expect(priceBand(9, priceBandAreaForVenue(BASE_ID))).toBe("expensive");
  });

  it("puts the note where a reader of a base pub's sheet can reach it", () => {
    const sheet = readFileSync(
      join(ROOT, "components/map/UnverifiedPubSheet.tsx"),
      "utf8",
    );
    expect(sheet).toContain("priceBandNote");
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
    expect(thresholdsTable.all).toEqual(thresholdsTable.cities.london);
    expect(thresholdsTable.minSample).toBe(MIN_PRICE_BAND_SAMPLE);
    expect(thresholdsTable.all.sampleSize).toBeGreaterThanOrEqual(MIN_PRICE_BAND_SAMPLE);
  });
});

// ---------------------------------------------------------------------------
// The tokens and the class family, read from the shipped stylesheets.

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const mix = (a: Rgb, b: Rgb, pa: number): Rgb => a.map((c, i) => Math.round(c * pa + defined(b[i]) * (1 - pa))) as Rgb;
const luminance = ([r, g, b]: Rgb) => {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a: Rgb, b: Rgb) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

function declarations(css: string, name: string): string[] {
  return [...css.matchAll(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "gm"))].map((m) => defined(m[1]).trim());
}

function hexTokens(css: string, name: string): Rgb[] {
  return declarations(css, name)
    .map((value) => /#([0-9a-f]{6})\b/i.exec(value)?.[0])
    .filter((value): value is string => Boolean(value))
    .map(hex);
}

function inkMix(css: string, name: string): { hue: string; share: number } {
  const value = declarations(css, name)[0];
  const m = /color-mix\(in srgb, var\(--(\w+)\) (\d+)%, var\(--ink\)\)/.exec(value ?? "");
  expect(m, `${name} is a color-mix of a hue and --ink`).not.toBeNull();
  return { hue: defined(m![1]), share: Number(m![2]) / 100 };
}

describe("the band tokens", () => {
  const globals = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  const theme = readFileSync(join(ROOT, "app", "theme.css"), "utf8");

  it("declare three hues over the semantic price palette and three inks", () => {
    expect(declarations(globals, "--price-band-cheap")).toEqual(["var(--pint)"]);
    expect(declarations(globals, "--price-band-average")).toEqual(["var(--amber)"]);
    expect(declarations(globals, "--price-band-expensive")).toEqual(["var(--brick)"]);
    for (const band of PRICE_BANDS) {
      expect(declarations(globals, `${PRICE_BAND_TOKEN[band]}-ink`)).toHaveLength(1);
      expect(declarations(theme, `${PRICE_BAND_TOKEN[band]}-ink`)).toHaveLength(1);
      expect(globals).toContain(`.priceBand-${band} {`);
    }
  });

  it("read as text at 4.5:1 or better on the page and the card, light and dark", () => {
    const light = {
      ink: hexTokens(globals, "--ink")[0],
      surfaces: [...hexTokens(globals, "--paper").slice(0, 2), ...hexTokens(globals, "--panel-raised").slice(0, 2)],
      hues: { pint: hexTokens(globals, "--pint")[0], amber: hexTokens(globals, "--amber")[0], brick: hexTokens(globals, "--brick")[0] },
      css: globals,
    };
    const dark = {
      ink: hexTokens(theme, "--ink")[0],
      surfaces: [hexTokens(theme, "--paper")[0], hexTokens(theme, "--panel-raised")[0]],
      hues: { pint: hexTokens(theme, "--pint")[0], amber: hexTokens(theme, "--amber")[0], brick: hexTokens(theme, "--brick")[0] },
      css: theme,
    };
    for (const [name, t] of Object.entries({ light, dark })) {
      expect(t.surfaces.length, `${name} surfaces found`).toBeGreaterThanOrEqual(2);
      for (const band of PRICE_BANDS) {
        const { hue, share } = inkMix(t.css, `${PRICE_BAND_TOKEN[band]}-ink`);
        const ink = mix(defined(t.hues[hue as keyof typeof t.hues]), defined(t.ink), share);
        for (const surface of t.surfaces) {
          expect(contrast(ink, defined(surface)), `${name} ${band} ink on ${JSON.stringify(surface)}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
