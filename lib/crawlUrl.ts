import type { CrawlStyle, Filters } from "@/lib/venues";
import { initialFilters, type CrawlMode } from "@/components/map/ControlRail";
import { categoryLabel, isDrinkCategory } from "@/lib/drinks";

// Alt crawl styles (issue #31): a light "what kind of night" label that rides
// alongside the scoring crawlStyle without touching it. It only shapes copy —
// e.g. a "coffee" crawl calls each stop a "coffee stop" — and the "mocktail"
// style naturally composes with the non-alcoholic filter. "pint" is the
// default (a classic pint crawl), so a plain link stays short.
export type AltCrawlStyle = "pint" | "food" | "coffee" | "mocktail";

export const ALT_CRAWL_STYLES: AltCrawlStyle[] = ["pint", "food", "coffee", "mocktail"];

// Display label for the control chip.
export const altStyleLabels: Record<AltCrawlStyle, string> = {
  pint: "Pint",
  food: "Food",
  coffee: "Coffee",
  mocktail: "Mocktail",
};

// The per-stop noun each style uses in copy ("coffee stop", "food stop", …).
export const altStyleStopNoun: Record<AltCrawlStyle, string> = {
  pint: "pint stop",
  food: "food stop",
  coffee: "coffee stop",
  mocktail: "mocktail stop",
};

// Styles that make sense to pair with the non-alcoholic filter — mocktail
// crawls are alcohol-free by nature, so the UI can offer to compose the two.
export function altStyleSuggestsNonAlcoholic(style: AltCrawlStyle): boolean {
  return style === "mocktail";
}

// Shareable-crawl URL: capture just enough of PubMap's state that a link
// reproduces the crawl. Kept short + human-ish, e.g.
//   ?mode=build&style=heritage&max=7&stops=6&win=20&pubs=id1,id2&sel=id
// Decode is defensive: unknown/malformed params are ignored, numbers clamp to
// the slider bounds, unknown styles drop. It NEVER throws on bad input.

export type CrawlUrlState = {
  mode: CrawlMode;
  filters: Filters;
  builtIds: string[];
  selectedVenueId: string;
  // Additive (issue #15 story bands): the active story-band id, or "" for none.
  // A bare id like `?band=river-history`; empty is the default so a plain link
  // stays short. Never validated against the band list here (keeps this module
  // decoupled from lib/storyBands) — an unknown id just resolves to no band.
  bandId?: string;
  // Additive (issue #31 alt crawl styles): the "kind of night" label. "pint" is
  // the default and is omitted from the URL; unknown values decode back to pint.
  altStyle?: AltCrawlStyle;
};

// The bounds mirror the sliders in ControlRail.tsx — keep in sync.
const CROSS_STYLES = new Set<CrawlStyle>([
  "balanced",
  "cheapest",
  "heritage",
  "writerTrail",
  "beerGarden",
  "sports",
  "dateNight",
]);
const MAX_PRICE = { min: 4, max: 9 };
const STOPS = { min: 4, max: 7 };
const WINDOW = { min: 15, max: 30 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseNum(raw: string | null, min: number, max: number): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n, min, max) : undefined;
}

export function encodeCrawl(state: CrawlUrlState): string {
  const { mode, filters, builtIds, selectedVenueId } = state;
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("style", filters.crawlStyle);
  params.set("max", String(filters.maxPrice));
  params.set("stops", String(filters.stopCount));
  params.set("win", String(filters.routeWindow));
  // Only the "on" case is encoded — off is the default, so a bare link stays short.
  if (filters.requirePintDrops) params.set("drops", "1");
  if (filters.requireNonAlcoholic) params.set("low", "1");
  if (filters.requireCocktails) params.set("cocktails", "1");
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (builtIds.length) params.set("pubs", builtIds.join(","));
  if (selectedVenueId) params.set("sel", selectedVenueId);
  // Only encode a band when one is active — off is the default.
  if (state.bandId) params.set("band", state.bandId);
  // Only encode an alt style when it isn't the default "pint".
  if (state.altStyle && state.altStyle !== "pint") params.set("alt", state.altStyle);
  return params.toString();
}

// Returns only the keys present + valid in the URL, so callers can spread over
// their defaults. Filters come back as a Partial too (merge onto initialFilters).
export function decodeCrawl(
  params: URLSearchParams,
): Partial<Omit<CrawlUrlState, "filters">> & { filters?: Partial<Filters> } {
  const out: Partial<Omit<CrawlUrlState, "filters">> & { filters?: Partial<Filters> } = {};

  const mode = params.get("mode");
  if (mode === "suggest" || mode === "build") out.mode = mode;

  const filters: Partial<Filters> = {};
  const style = params.get("style");
  if (style && CROSS_STYLES.has(style as CrawlStyle)) filters.crawlStyle = style as CrawlStyle;
  const max = parseNum(params.get("max"), MAX_PRICE.min, MAX_PRICE.max);
  if (max !== undefined) filters.maxPrice = max;
  const stops = parseNum(params.get("stops"), STOPS.min, STOPS.max);
  if (stops !== undefined) filters.stopCount = Math.round(stops);
  const win = parseNum(params.get("win"), WINDOW.min, WINDOW.max);
  if (win !== undefined) filters.routeWindow = win;
  // Only "1" turns it on; any other/absent value leaves it at the default (off).
  if (params.get("drops") === "1") filters.requirePintDrops = true;
  if (params.get("low") === "1") filters.requireNonAlcoholic = true;
  if (params.get("cocktails") === "1") filters.requireCocktails = true;
  const q = params.get("q")?.trim();
  if (q) filters.query = q.slice(0, 80);
  // Discover → map drink deep-links (`?drink=` from exploreHref).
  // Fully filterable against venue amenity / index data today:
  //   low-no → requireNonAlcoholic (+ mocktail alt style)
  //   cocktail → requireCocktails
  // Soft-link only (text query; may return few/no pins until drink rows land):
  //   wine → query "Wine" (pint dataset sometimes mentions wine lists)
  // Not filterable yet (no inventing fake amenity flags) — open map without a
  // blanking query: beer, whisky, gin, vodka, rum, shot, other.
  const drink = params.get("drink")?.trim();
  if (drink === "low-no") {
    filters.requireNonAlcoholic = true;
    out.altStyle = "mocktail";
  } else if (isDrinkCategory(drink)) {
    if (drink === "cocktail") filters.requireCocktails = true;
    // Soft text query for every drink family so landing drink-shape taps
    // open a usefully narrowed map (wine lists, gin bars, whisky pubs…).
    // Cocktail already has a hard amenity filter; keep the query too so the
    // search field mirrors what the visitor tapped.
    if (!filters.query) {
      filters.query = categoryLabel(drink);
    }
  }
  if (Object.keys(filters).length) out.filters = filters;

  const pubs = params.get("pubs");
  if (pubs) {
    const ids = pubs.split(",").map((id) => id.trim()).filter(Boolean);
    if (ids.length) out.builtIds = ids;
  }

  const sel = params.get("sel");
  if (sel) out.selectedVenueId = sel;

  const band = params.get("band");
  if (band) out.bandId = band.trim();

  const alt = params.get("alt");
  if (alt && ALT_CRAWL_STYLES.includes(alt as AltCrawlStyle)) {
    out.altStyle = alt as AltCrawlStyle;
  }

  return out;
}

// Convenience: fold a decoded URL onto the app defaults into full initial state.
export function seedCrawlState(search: string): {
  mode: CrawlMode;
  filters: Filters;
  builtIds: string[];
  selectedVenueId: string;
  bandId: string;
  altStyle: AltCrawlStyle;
} {
  const decoded = decodeCrawl(new URLSearchParams(search));
  return {
    mode: decoded.mode ?? "suggest",
    filters: { ...initialFilters, ...decoded.filters },
    builtIds: decoded.builtIds ?? [],
    selectedVenueId: decoded.selectedVenueId ?? "",
    bandId: decoded.bandId ?? "",
    altStyle: decoded.altStyle ?? "pint",
  };
}
