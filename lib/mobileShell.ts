import type { Filters } from "@/lib/venues";
import { parseCityId, type CityId } from "@/lib/cities";
import type { SheetSnap } from "@/lib/sheetSnap";
import { NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";

export type MapOverlay =
  | "none"
  | "search"
  | "filters"
  | "tfl"
  | "tonight"
  | "layers"
  | "venue"
  | "planner"
  | "pub-pal"
  | "moment";

export type MapSheetKind = Exclude<MapOverlay, "none" | "search">;
export type MapSheetDetent = SheetSnap;

export type MapViewportSnapshot = {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
};

export type NearbyMapResult = {
  location: { lat: number; lng: number };
  venueIds: string[];
  radiusKm: 2.5;
  strategy: "within-radius" | "nearest-20";
};

export type MobileShellState = {
  overlay: MapOverlay;
  viewport: MapViewportSnapshot | null;
  selectedVenueId: string | null;
  cityId: CityId;
  nightArea: NightAreaSlug | null;
  transitNetworkVisible: boolean;
};

export type MobileMapSessionV1 = {
  version: 1;
  savedAt: string;
  viewport: MapViewportSnapshot | null;
  filters: Filters;
  cityId: CityId;
  nightArea: NightAreaSlug | null;
  selectedVenueId: string | null;
  openSheet: MapSheetKind | null;
  transitNetworkVisible: boolean;
};

export const MOBILE_MAP_SESSION_KEY = "pubmaxx.mobile-map-session.v1";

const RESTORABLE_SHEETS = new Set<MapSheetKind>([
  "filters",
  "tfl",
  "tonight",
  "layers",
  "venue",
  "planner",
  "pub-pal",
]);
const CRAWL_STYLES = new Set([
  "balanced",
  "cheapest",
  "heritage",
  "writerTrail",
  "beerGarden",
  "sports",
  "dateNight",
]);
const FILTER_BOOLEAN_KEYS = [
  "requireBeerGarden",
  "requireNonAlcoholic",
  "requireLiveSports",
  "requireFood",
  "requireCocktails",
  "requireWater",
  "requireHeritage",
  "requirePintDrops",
  "canonicalOnly",
  "requireStepFree",
  "requireAccessibleToilet",
  "requireSeatedService",
] as const;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNightAreaSlug(value: unknown): value is NightAreaSlug {
  return typeof value === "string" && (NIGHT_AREA_SLUGS as readonly string[]).includes(value);
}

export function validateMapViewport(value: unknown): MapViewportSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<MapViewportSnapshot>;
  if (!Array.isArray(raw.center) || raw.center.length !== 2) return null;
  if (![...raw.center, raw.zoom, raw.pitch, raw.bearing].every(finite)) return null;
  const [lng, lat] = raw.center;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  if ((raw.zoom ?? -1) < 0 || (raw.zoom ?? 99) > 24) return null;
  return {
    center: [lng, lat],
    zoom: raw.zoom!,
    pitch: Math.max(0, Math.min(85, raw.pitch!)),
    bearing: raw.bearing!,
  };
}

export function validateMobileMapFilters(value: unknown): Filters | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Filters>;
  if (
    typeof raw.query !== "string" ||
    typeof raw.drinkCategory !== "string" ||
    typeof raw.drinkBrand !== "string" ||
    !finite(raw.maxPrice) || raw.maxPrice < 0 || raw.maxPrice > 100 ||
    !finite(raw.stopCount) || raw.stopCount < 1 || raw.stopCount > 20 ||
    !finite(raw.routeWindow) || raw.routeWindow < 1 || raw.routeWindow > 120 ||
    typeof raw.crawlStyle !== "string" || !CRAWL_STYLES.has(raw.crawlStyle) ||
    !FILTER_BOOLEAN_KEYS.every((key) => typeof raw[key] === "boolean")
  ) return null;
  return raw as Filters;
}

export function readMobileMapSession(): MobileMapSessionV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(window.localStorage.getItem(MOBILE_MAP_SESSION_KEY) ?? "null") as Partial<MobileMapSessionV1> | null;
    const cityId = parseCityId(raw?.cityId);
    const filters = validateMobileMapFilters(raw?.filters);
    if (!raw || raw.version !== 1 || !filters || !cityId) return null;
    return {
      version: 1,
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date(0).toISOString(),
      viewport: validateMapViewport(raw.viewport),
      filters,
      cityId,
      nightArea: isNightAreaSlug(raw.nightArea) ? raw.nightArea : null,
      selectedVenueId: typeof raw.selectedVenueId === "string" ? raw.selectedVenueId : null,
      transitNetworkVisible: typeof raw.transitNetworkVisible === "boolean"
        ? raw.transitNetworkVisible
        : false,
      openSheet: typeof raw.openSheet === "string" && RESTORABLE_SHEETS.has(raw.openSheet as MapSheetKind)
        ? (raw.openSheet as MapSheetKind)
        : null,
    };
  } catch {
    return null;
  }
}

export function writeMobileMapSession(value: Omit<MobileMapSessionV1, "version" | "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOBILE_MAP_SESSION_KEY, JSON.stringify({
      ...value,
      version: 1,
      savedAt: new Date().toISOString(),
    } satisfies MobileMapSessionV1));
  } catch {
    // Cross-tab recovery is best-effort in private/quota-constrained browsers.
  }
}
