// The price band a pint figure falls into, and the ONE rule that decides it.
//
// CAPTAIN'S LAW (2026-09-05, "I already told you"): RED means expensive, YELLOW
// means affordable and average, GREEN means cheap. Colour on a price carries
// the BAND and nothing else. How far to trust a figure (confirmed, listed,
// estimated, a lone report) is said in words, a badge or a pin shape, never in
// a traffic-light tone, because a reader who saw a green "Confirmed" over a
// dear pint was being told two things by one hue.
//
// THE RULE IS TERCILES OF THE CITY'S PRICED PUBS. Sort every curated pub pint
// price the city holds, cheapest first. The cheapest third is `cheap`, the
// middle third is `average`, the dearest third is `expensive`. A price sitting
// exactly on a boundary belongs to the lower band. Terciles were chosen over a
// median-plus-margin rule because they need no invented margin: "average" is
// honestly the middle third of what we hold, and the thresholds are two prices
// somebody actually pays. London today: cheap up to £5.20, average up to £6.15,
// expensive above (950 priced pubs), so a £6.50 pint reads expensive.
//
// THE AREA IS THE CITY, NOT THE BOROUGH. A per-borough rule was measured and
// rejected: City of London's and Westminster's upper terciles both sit at
// £6.50, so the very pint the captain called expensive would have read
// "average" on its own doorstep, and a drinker's wallet does not reset at a
// borough line. The numbers are in docs/PRICE_BANDS.md.
//
// THE THRESHOLDS ARE DERIVED, NEVER TYPED. `npm run build:price-bands` writes
// public/data/price_bands/thresholds.json from the shipped city packs, and
// __tests__/priceBand.test.ts recomputes them so a re-collected dataset cannot
// leave the table stale. A city under `MIN_PRICE_BAND_SAMPLE` priced pubs has
// no honest terciles of its own and takes the whole dataset's thresholds
// (`basis: "all"`); today every priced pub is in London, so the two agree.
//
// THIS IS A PINT BAND. It is asked of pint figures alone: a £12 cocktail
// against pint terciles says nothing, so a non-beer figure asks nothing and
// wears no band. And a band is never authority: which figure a surface may
// colour at all is still that surface's own law (corroboration for a pin,
// `priceStandingFor` for a standing); this module only says what colour a
// figure that MAY be painted is painted.

import { cityIdFromVenueId, isNationalBaseVenueId } from "@/lib/cityVenueIds";
import thresholdsTable from "@/public/data/price_bands/thresholds.json";

export const PRICE_BANDS = ["cheap", "average", "expensive"] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];

/** The two prices that split a city's priced pubs into thirds. */
export type PriceBandThresholds = Readonly<{
  /** The dearest price still `cheap`: the price at the first tercile. */
  cheapMaxGbp: number;
  /** The dearest price still `average`: the price at the second tercile. */
  averageMaxGbp: number;
  /** How many priced pubs the two prices were cut from. */
  sampleSize: number;
}>;

/**
 * Fewer priced pubs than this and a tercile is a coin toss rather than a
 * distribution, so the city has no thresholds of its own.
 */
export const MIN_PRICE_BAND_SAMPLE = 30;

/** Where a figure is being read. Absent or unknown means the whole dataset. */
export type PriceBandArea = Readonly<{ city?: string | null }> | null | undefined;

export type PriceBandBasis = Readonly<{
  thresholds: PriceBandThresholds;
  /** `city` when the area has its own terciles, `all` when it borrowed the dataset's. */
  basis: "city" | "all";
}>;

type ThresholdsTable = Readonly<{
  rule: string;
  minSample: number;
  all: PriceBandThresholds;
  cities: Readonly<Record<string, PriceBandThresholds>>;
  sampleSizes: Readonly<Record<string, number>>;
}>;

const TABLE = thresholdsTable as ThresholdsTable;

function isThresholds(value: unknown): value is PriceBandThresholds {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.cheapMaxGbp === "number" &&
    Number.isFinite(row.cheapMaxGbp) &&
    typeof row.averageMaxGbp === "number" &&
    Number.isFinite(row.averageMaxGbp) &&
    row.cheapMaxGbp <= row.averageMaxGbp &&
    typeof row.sampleSize === "number" &&
    Number.isInteger(row.sampleSize) &&
    row.sampleSize >= 0
  );
}

/**
 * The tercile thresholds of a list of prices, or null when the list is too
 * thin to cut. The rule is nearest-rank on the sorted list: with n prices the
 * first tercile is the price at index floor((n - 1) / 3) and the second at
 * floor(2 (n - 1) / 3). Nothing is interpolated, so each threshold is a price
 * a real pub charges. A non-finite or non-positive price is dropped, because a
 * £0 row is a missing figure and not a free pint.
 */
export function priceBandThresholdsFrom(
  prices: readonly number[],
  minSample: number = MIN_PRICE_BAND_SAMPLE,
): PriceBandThresholds | null {
  const sorted = prices
    .filter((price) => Number.isFinite(price) && price > 0)
    .slice()
    .sort((a, b) => a - b);
  if (sorted.length < Math.max(1, minSample)) return null;
  const last = sorted.length - 1;
  const cheapMaxGbp = sorted[Math.floor(last / 3)];
  const averageMaxGbp = sorted[Math.floor((2 * last) / 3)];
  if (cheapMaxGbp === undefined || averageMaxGbp === undefined) return null;
  return {
    cheapMaxGbp,
    averageMaxGbp,
    sampleSize: sorted.length,
  };
}

/**
 * The area a venue's figure is read in: its city, from the id prefix every
 * city pack stamps (lib/cityVenueIds.ts). A curated London id carries no prefix
 * and answers "london".
 *
 * A NATIONAL BASE PUB NAMES NO CITY (review finding F-21). `venue-uk-…` ids
 * carry no three-letter prefix, so the old `?? "london"` fallback labelled every
 * unpriced pub in the country a London one, and `priceBandNote` then told a
 * reader in Newcastle their pint sat in "the cheapest third of 952 priced pubs"
 * in London. It answers null instead, which reads the whole dataset's row and
 * says so in the note.
 */
export function priceBandAreaForVenue(venueId: string | null | undefined): PriceBandArea {
  if (!venueId) return null;
  if (isNationalBaseVenueId(venueId)) return { city: null };
  return { city: cityIdFromVenueId(venueId) ?? "london" };
}

/** The thresholds an area reads, and whether they are its own. */
export function priceBandBasisFor(area?: PriceBandArea): PriceBandBasis {
  const city = area?.city?.trim().toLowerCase() ?? "";
  const own = city ? TABLE.cities[city] : undefined;
  if (own && isThresholds(own) && own.sampleSize >= TABLE.minSample) {
    return { thresholds: own, basis: "city" };
  }
  return { thresholds: TABLE.all, basis: "all" };
}

export function priceBandThresholdsFor(area?: PriceBandArea): PriceBandThresholds {
  return priceBandBasisFor(area).thresholds;
}

/**
 * The band a pint figure falls into. Null for no figure: a missing price wears
 * no colour rather than the colour of a guess.
 */
export function priceBand(
  priceGbp: number | null | undefined,
  area?: PriceBandArea,
): PriceBand | null {
  if (typeof priceGbp !== "number" || !Number.isFinite(priceGbp) || priceGbp <= 0) {
    return null;
  }
  const { cheapMaxGbp, averageMaxGbp } = priceBandThresholdsFor(area);
  if (priceGbp <= cheapMaxGbp) return "cheap";
  if (priceGbp <= averageMaxGbp) return "average";
  return "expensive";
}

/**
 * The map's numeric vocabulary for the same answer: 0 cheap, 1 average,
 * 2 expensive, 3 no price. `priceBucket` in lib/communityPrice.ts is this
 * function under its older name, kept so the pin, the cluster donuts and the
 * OG band counter keep their existing tests.
 */
export function priceBandBucket(
  priceGbp: number | null | undefined,
  area?: PriceBandArea,
): 0 | 1 | 2 | 3 {
  switch (priceBand(priceGbp, area)) {
    case "cheap":
      return 0;
    case "average":
      return 1;
    case "expensive":
      return 2;
    default:
      return 3;
  }
}

/** The bucket's band, for a surface that already holds the map's number. */
export function priceBandFromBucket(bucket: number): PriceBand | null {
  return bucket === 0 ? "cheap" : bucket === 1 ? "average" : bucket === 2 ? "expensive" : null;
}

/**
 * The ONE class family a band paints with. Defined once in app/globals.css
 * beside the tokens: each class sets `--price-band-hue` and `--price-band-ink`
 * on the element and re-tints the price plaque, so a badge, a bare figure and a
 * pill all take the band from the same three declarations. No band, no class.
 */
export function priceBandClass(band: PriceBand | null | undefined): string {
  return band ? `priceBand-${band}` : "";
}

/** The design token each band's hue is read from. */
export const PRICE_BAND_TOKEN: Record<PriceBand, `--price-band-${PriceBand}`> = {
  cheap: "--price-band-cheap",
  average: "--price-band-average",
  expensive: "--price-band-expensive",
};

/** The word a legend or a title prints beside the colour. */
export function priceBandLabel(band: PriceBand): string {
  switch (band) {
    case "cheap":
      return "Cheap";
    case "average":
      return "Average";
    case "expensive":
      return "Expensive";
  }
}

function gbp(value: number): string {
  return `£${value.toFixed(2).replace(/\.00$/, "")}`;
}

/**
 * The legend line for a band, carrying the thresholds it was cut at, so a
 * reader learns the numbers and not only the colours. The map's legend, the
 * first-map orientation beat and the Layers price cap all print these.
 */
export function priceBandLegendLabel(band: PriceBand, area?: PriceBandArea): string {
  const { cheapMaxGbp, averageMaxGbp } = priceBandThresholdsFor(area);
  switch (band) {
    case "cheap":
      return `${gbp(cheapMaxGbp)} or less`;
    case "average":
      return `Over ${gbp(cheapMaxGbp)}, up to ${gbp(averageMaxGbp)}`;
    case "expensive":
      return `Over ${gbp(averageMaxGbp)}`;
  }
}

/**
 * What the thresholds a figure was cut against are OF, in one noun phrase.
 *
 * Review finding F-21: `basis` was returned by `priceBandBasisFor` and read by
 * nothing, so a Manchester or Bristol figure was coloured against London's
 * terciles and the note called them the reader's own. Every city outside London
 * ships `sampleSize: 0` today, so this is not a rare path: it is every one of
 * them, plus the whole national base layer. The band still paints - the whole
 * dataset is the honest fallback and today it IS London - and the sentence now
 * says whose numbers they are rather than implying the pub's own city.
 */
export function priceBandBasisNoun(area?: PriceBandArea): string {
  return priceBandBasisFor(area).basis === "city"
    ? "priced pubs"
    : "priced pubs across every city we hold";
}

/** One sentence naming the rule, for a title attribute or a method page. */
export function priceBandNote(band: PriceBand, area?: PriceBandArea): string {
  const { sampleSize } = priceBandThresholdsFor(area);
  const third =
    band === "cheap" ? "cheapest third" : band === "average" ? "middle third" : "dearest third";
  return `${priceBandLabel(band)}: in the ${third} of ${sampleSize} ${priceBandBasisNoun(area)} (${priceBandLegendLabel(band, area)}).`;
}
