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

export function mapPriceLegend(hasTypeRelativePrices: boolean): {
  rows: MapPriceLegendRow[];
  ariaLabel: string;
  title: string;
  hint: string;
} {
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
