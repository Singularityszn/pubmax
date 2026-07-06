import type { CrawlStyle, Filters } from "@/lib/venues";
import { initialFilters, type CrawlMode } from "@/components/map/ControlRail";

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
  if (builtIds.length) params.set("pubs", builtIds.join(","));
  if (selectedVenueId) params.set("sel", selectedVenueId);
  // Only encode a band when one is active — off is the default.
  if (state.bandId) params.set("band", state.bandId);
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

  return out;
}

// Convenience: fold a decoded URL onto the app defaults into full initial state.
export function seedCrawlState(search: string): {
  mode: CrawlMode;
  filters: Filters;
  builtIds: string[];
  selectedVenueId: string;
  bandId: string;
} {
  const decoded = decodeCrawl(new URLSearchParams(search));
  return {
    mode: decoded.mode ?? "suggest",
    filters: { ...initialFilters, ...decoded.filters },
    builtIds: decoded.builtIds ?? [],
    selectedVenueId: decoded.selectedVenueId ?? "",
    bandId: decoded.bandId ?? "",
  };
}
