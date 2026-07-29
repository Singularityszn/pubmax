import type { CategoryPriceIndexStatus } from "@/lib/mapExperienceLens";

export type MapPriceLegendRow = {
  label: string;
  symbol: "£" | "££" | "£££" | "?";
  tone: "green" | "amber" | "red" | "grey";
};

export type MapKeyEntry = {
  id: string;
  label: string;
  detail: string;
};

export type MapPriceLegendModel = {
  rows: MapPriceLegendRow[];
  ariaLabel: string;
  title: string;
  hint: string;
  clusterNote: string;
  shapes: MapKeyEntry[];
  marks: MapKeyEntry[];
  routeMarks: MapKeyEntry[];
  noAlcoholNote: string;
};

const CLUSTER_NOTE =
  "A split cluster ring shows the mix of price bands inside it. A solid cluster uses the most common known price band. The number is every pub in the cluster.";

const MAP_SHAPES: MapKeyEntry[] = [
  {
    id: "pub-drink",
    label: "Pint, wine, cocktail or spirit glass",
    detail: "Pub. The glass follows its recorded drinks or the drink view you chose.",
  },
  { id: "bar", label: "Coupe glass", detail: "Bar." },
  { id: "late-food", label: "Skewer", detail: "Late food." },
  { id: "restaurant", label: "Fork", detail: "Restaurant." },
  {
    id: "base-pub",
    label: "Hollow circle and dot",
    detail: "Pub on the UK base map. No map price.",
  },
  {
    id: "landmark",
    label: "Brass pictogram",
    detail: "Landmark, not a pub.",
  },
];

const MAP_MARKS: MapKeyEntry[] = [
  {
    id: "your-location",
    label: "Blue centre with a pulse",
    detail: "Your approximate location.",
  },
  {
    id: "provisional",
    label: "Small blue dot beside a pin",
    detail: "One recent pint report. A second independent drinker agreeing can set the pin's band.",
  },
  {
    id: "pint-drop",
    label: "Blue ring",
    detail: "This pub has a visible Pint Drop.",
  },
  { id: "quiz", label: "Amber ring", detail: "Quiz on tonight." },
  { id: "sport", label: "Bright blue ring", detail: "Live sport shown here." },
  { id: "deal", label: "Bright brass ring", detail: "Deal on tonight." },
  { id: "music", label: "Dark blue ring", detail: "Live music tonight." },
  {
    id: "public-listing",
    label: "Thin brass ring",
    detail: "Pub added from a public listing.",
  },
  {
    id: "selected",
    label: "Double brass ring",
    detail: "Pub you selected.",
  },
  {
    id: "story-band",
    label: "Coloured ring",
    detail: "Pub in the place story you chose.",
  },
];

const ROUTE_MARKS: MapKeyEntry[] = [
  {
    id: "crawl-stop",
    label: "Numbered dark circle",
    detail: "Stop in your crawl.",
  },
  {
    id: "walking-route",
    label: "Solid line",
    detail: "Walking route along roads.",
  },
  {
    id: "straight-route",
    label: "Dashed line",
    detail: "Straight estimate while a road route is unavailable.",
  },
];

const NO_ALCOHOL_NOTE =
  "The no-alcohol view has no separate pin shape. It uses alcohol-free and soft drink prices. Missing prices stay grey.";

function priceRows(noun: string): MapPriceLegendRow[] {
  return [
    { label: "£5.50 or less", symbol: "£", tone: "green" },
    { label: "Over £5.50, up to £7", symbol: "££", tone: "amber" },
    { label: "Over £7", symbol: "£££", tone: "red" },
    {
      label: `No ${noun} price on the map`,
      symbol: "?",
      tone: "grey",
    },
  ];
}

function mixedPriceRows(): MapPriceLegendRow[] {
  return [
    {
      label: "£5.50 or less; low for its venue type",
      symbol: "£",
      tone: "green",
    },
    {
      label: "Over £5.50, up to £7; middle for its venue type",
      symbol: "££",
      tone: "amber",
    },
    {
      label: "Over £7; high for its venue type",
      symbol: "£££",
      tone: "red",
    },
    {
      label: "No pint or venue price on the map",
      symbol: "?",
      tone: "grey",
    },
  ];
}

function withMapKey(
  legend: Pick<MapPriceLegendModel, "rows" | "ariaLabel" | "title" | "hint">,
): MapPriceLegendModel {
  return {
    ...legend,
    clusterNote: CLUSTER_NOTE,
    shapes: MAP_SHAPES,
    marks: MAP_MARKS,
    routeMarks: ROUTE_MARKS,
    noAlcoholNote: NO_ALCOHOL_NOTE,
  };
}

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
  drinkNoun?: string,
): MapPriceLegendModel {
  if (drinkLabel) {
    const drink = (drinkNoun ?? drinkLabel).toLowerCase();
    const unreadable = drinkIndexStatus === "degraded";
    const rows = priceRows(drink);
    return withMapKey({
      // A failed category read leaves every pin in the unknown band, so keep
      // that row and drop only the bands no pin can currently wear.
      rows: unreadable ? rows.slice(-1) : rows,
      ariaLabel: unreadable
        ? `${drinkLabel} price colour key, unavailable`
        : `${drinkLabel} price colour key`,
      title: unreadable
        ? `${drinkLabel} prices unavailable`
        : `${drinkLabel} price bands`,
      hint: drinkHint(drink, drinkIndexStatus),
    });
  }
  if (!hasTypeRelativePrices) {
    return withMapKey({
      rows: priceRows("pint"),
      ariaLabel: "Pint price key and filters",
      title: "Pint price key and filters",
      hint: "Show pubs at or under this pint price.",
    });
  }
  return withMapKey({
    rows: mixedPriceRows(),
    ariaLabel:
      "Price colour key: pub pints use pound thresholds; other venue types use relative low, middle, and high bands",
    title: "Pint prices and other venue price bands",
    hint:
      "Pub pins use pint thresholds. Each other venue pin is low, middle, or high within its own type.",
  });
}
