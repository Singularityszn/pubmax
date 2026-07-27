import type { CategoryPriceIndexStatus } from "@/lib/mapExperienceLens";

export type MapPriceLegendRow = {
  label: string;
  tone: "green" | "amber" | "red";
};

const PINT_PRICE_LEGEND: MapPriceLegendRow[] = [
  { label: "≤ £5.50", tone: "green" },
  { label: "> £5.50–≤ £7", tone: "amber" },
  { label: "> £7", tone: "red" },
];

const MIXED_PRICE_LEGEND: MapPriceLegendRow[] = [
  { label: "≤ £5.50 · relative low", tone: "green" },
  { label: "> £5.50–≤ £7 · relative middle", tone: "amber" },
  { label: "> £7 · relative high", tone: "red" },
];

/**
 * The key's hint is the map's own claim about how complete its colours are, so
 * it reports the index's three states apart: a partial read still painted real
 * figures and keeps the "trusted prices" sentence, while a failed read says so
 * rather than letting an all-unknown map read as a city with no prices in it.
 */
function drinkHint(drink: string, status: CategoryPriceIndexStatus): string {
  if (status === "idle" || status === "loading") {
    return `Checking ${drink} prices. Pubs without a trusted one stay unknown.`;
  }
  if (status === "degraded") {
    return `We could not read the ${drink} prices just now, so no pub is coloured by one yet.`;
  }
  if (status === "partial") {
    return `Pin colours follow trusted ${drink} prices, read from part of the list. Pubs without one stay unknown.`;
  }
  return `Pin colours follow trusted ${drink} prices. Pubs without one stay unknown.`;
}

export function mapPriceLegend(
  hasTypeRelativePrices: boolean,
  drinkLabel?: string,
  drinkIndexStatus: CategoryPriceIndexStatus = "ready",
): {
  rows: MapPriceLegendRow[];
  ariaLabel: string;
  title: string;
  hint: string;
} {
  if (drinkLabel) {
    const drink = drinkLabel.toLowerCase();
    // A colour scale that currently maps to no pin is a key to nothing, so the
    // unreadable state drops the rows rather than pairing them with a hint that
    // says nothing is coloured.
    const unreadable = drinkIndexStatus === "degraded";
    return {
      rows: unreadable ? [] : PINT_PRICE_LEGEND,
      ariaLabel: unreadable
        ? `${drinkLabel} price colour key, unavailable`
        : `${drinkLabel} price colour key`,
      title: unreadable
        ? `${drinkLabel} prices unavailable`
        : `${drinkLabel} price bands`,
      hint: drinkHint(drink, drinkIndexStatus),
    };
  }
  if (!hasTypeRelativePrices) {
    return {
      rows: PINT_PRICE_LEGEND,
      ariaLabel: "Pint price key and filters",
      title: "Pint price key and filters",
      hint: "Show pubs at or under this pint price.",
    };
  }
  return {
    rows: MIXED_PRICE_LEGEND,
    ariaLabel:
      "Price colour key: pub pints use pound thresholds; bars and late food use relative low, middle, and high bands",
    title: "Pub pint thresholds and type-relative venue price bands",
    hint:
      "Pub pins use pint thresholds. Bars and late food use low, middle, and high bands within their type.",
  };
}
