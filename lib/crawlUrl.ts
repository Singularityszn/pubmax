import type { CrawlStyle, Filters } from "@/lib/venues";
import { initialFilters, type CrawlMode } from "@/components/map/ControlRail";
import {
  findBrand,
  normalizeBrandQuery,
  parseDrinkCategoryParam,
} from "@/lib/drinkBrands";
import { isDrinkCategory } from "@/lib/drinks";

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
  /** Shareable landmark chapter deep link (`?landmark=big-ben`). */
  landmarkId?: string;
  /** Named curated crawl id (`?crawl=victorian-soho`) for map-first hydration. */
  crawlId?: string;
};

/** Normalize a crawl= param to a slug-ish id (defensive; never throws). */
function normalizeCrawlId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

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
  // Omit defaults so a fresh /map tab stays `/map` instead of dumping
  // ?mode=suggest&style=balanced&max=7&stops=6&win=20 into the address bar.
  // Share links still round-trip anything that differs from initialFilters.
  if (mode !== "suggest") params.set("mode", mode);
  if (filters.crawlStyle !== initialFilters.crawlStyle) {
    params.set("style", filters.crawlStyle);
  }
  if (filters.maxPrice !== initialFilters.maxPrice) {
    params.set("max", String(filters.maxPrice));
  }
  if (filters.stopCount !== initialFilters.stopCount) {
    params.set("stops", String(filters.stopCount));
  }
  if (filters.routeWindow !== initialFilters.routeWindow) {
    params.set("win", String(filters.routeWindow));
  }
  // Only the "on" case is encoded — off is the default, so a bare link stays short.
  if (filters.requirePintDrops) params.set("drops", "1");
  if (filters.requireNonAlcoholic) params.set("low", "1");
  if (filters.requireCocktails) params.set("cocktails", "1");
  if (filters.requireFood) params.set("food", "1");
  if (filters.query.trim()) params.set("q", filters.query.trim());
  // Drink lens (Wave C): round-trip ?drink= + optional ?brand=.
  const drinkCategory = filters.drinkCategory?.trim();
  if (drinkCategory && isDrinkCategory(drinkCategory)) {
    params.set("drink", drinkCategory);
  }
  const drinkBrand = normalizeBrandQuery(filters.drinkBrand);
  if (drinkBrand && findBrand(drinkBrand)) {
    params.set("brand", drinkBrand);
  }
  if (builtIds.length) params.set("pubs", builtIds.join(","));
  if (selectedVenueId) params.set("sel", selectedVenueId);
  // Only encode a band when one is active — off is the default.
  if (state.bandId) params.set("band", state.bandId);
  if (state.landmarkId) params.set("landmark", state.landmarkId);
  // Only encode an alt style when it isn't the default "pint".
  if (state.altStyle && state.altStyle !== "pint") params.set("alt", state.altStyle);
  if (state.crawlId) params.set("crawl", state.crawlId);
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
  if (params.get("food") === "1") filters.requireFood = true;
  const q = params.get("q")?.trim();
  if (q) filters.query = q.slice(0, 80);

  // Discover → map drink deep-links (`?drink=` / `?brand=` from exploreHref).
  //   low-no / non-alcoholic → requireNonAlcoholic (+ mocktail alt style)
  //   cocktail → requireCocktails + drinkCategory
  //   wine/vodka/gin/… → drinkCategory (+ optional drinkBrand)
  // `cocktails=1` alone lights the cocktail lens when `drink=` is absent;
  // an explicit `drink=` category always wins.
  const cocktailsFlag = params.get("cocktails") === "1";
  if (cocktailsFlag) filters.requireCocktails = true;

  const drinkRaw = params.get("drink")?.trim().toLowerCase() ?? "";
  if (drinkRaw === "low-no" || drinkRaw === "non-alcoholic") {
    filters.requireNonAlcoholic = true;
    out.altStyle = "mocktail";
  } else {
    const drinkCategory = parseDrinkCategoryParam(drinkRaw);
    if (drinkCategory) {
      // Lens via drinkCategory only — do NOT also set filters.query to the
      // category label. That AND'd with drinkCategory and dropped slim pins
      // whose wine/gin hints don't appear in name/searchText (false negatives).
      filters.drinkCategory = drinkCategory;
      if (drinkCategory === "cocktail") filters.requireCocktails = true;
    } else if (cocktailsFlag) {
      filters.drinkCategory = "cocktail";
    }
  }

  const brandRaw = normalizeBrandQuery(params.get("brand"));
  if (brandRaw) {
    const hit = findBrand(brandRaw);
    if (hit) {
      filters.drinkBrand = hit.brand.id;
      // Brand implies its category when drink= was omitted or mismatched.
      if (!filters.drinkCategory) filters.drinkCategory = hit.category;
      if (hit.category === "cocktail") filters.requireCocktails = true;
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

  const landmark = params.get("landmark");
  if (landmark) out.landmarkId = landmark.trim();

  const crawl = params.get("crawl");
  if (crawl) {
    const crawlId = normalizeCrawlId(crawl);
    if (crawlId) out.crawlId = crawlId;
  }

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
  landmarkId: string;
  crawlId: string;
} {
  const decoded = decodeCrawl(new URLSearchParams(search));
  return {
    mode: decoded.mode ?? "suggest",
    filters: { ...initialFilters, ...decoded.filters },
    builtIds: decoded.builtIds ?? [],
    selectedVenueId: decoded.selectedVenueId ?? "",
    bandId: decoded.bandId ?? "",
    altStyle: decoded.altStyle ?? "pint",
    landmarkId: decoded.landmarkId ?? "",
    crawlId: decoded.crawlId ?? "",
  };
}
