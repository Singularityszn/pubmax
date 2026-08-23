import { DEFAULT_CITY_ID, getCity, parseCityId, type CityId } from "@/lib/cities";
import { cityAwareMapPath } from "@/lib/curatedCrawls";
import {
  isNightAreaRouteReady,
  tryGetNightArea,
  type NightArea,
} from "@/lib/nightAreas";
import { planPalRouteHandoffHref } from "@/lib/planOccasion";

export type NightAreaActivationReason =
  | "route-ready"
  | "not-ready"
  | "unknown"
  | "city-mismatch"
  | "invalid-city";

export type NightAreaActivationState = {
  kind: "ready" | "browse";
  reason: NightAreaActivationReason;
  area: NightArea | null;
  areaName: string | null;
  cityId: CityId;
  primaryAction: {
    label: string;
    href: string;
  };
};

export type ResolveNightAreaActivationInput = {
  slug: string | null | undefined;
  /** Missing city means the canonical London route. An invalid city fails closed. */
  cityId?: string | null;
  now?: Date;
};

function humanLabelFromSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // Keep the safe raw slug when a malformed path segment reaches this helper.
  }
  const label = decoded
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  if (!label) return null;
  return `${label.slice(0, 1).toLocaleUpperCase()}${label.slice(1)}`;
}

function browseHref(cityId: CityId, areaName: string | null): string {
  if (!areaName) return cityAwareMapPath(cityId);
  return cityAwareMapPath(cityId, new URLSearchParams({ q: areaName }));
}

function browseState(
  reason: Exclude<NightAreaActivationReason, "route-ready" | "not-ready">,
  cityId: CityId,
  area: NightArea | null,
  areaName: string | null,
): NightAreaActivationState {
  const cityName = getCity(cityId).displayName;
  const href = reason === "city-mismatch" || reason === "invalid-city"
    ? cityAwareMapPath(cityId)
    : browseHref(cityId, areaName);
  return {
    kind: "browse",
    reason,
    area,
    areaName,
    cityId,
    primaryAction: {
      label: reason === "unknown"
        ? "Browse the map"
        : reason === "invalid-city"
          ? `Open the ${cityName} map`
        : reason === "city-mismatch"
          ? `Open the ${cityName} map`
          : `Browse ${areaName ?? "the map"} pubs`,
      href,
    },
  };
}

/**
 * Resolves the only two activation doors this route may offer.
 *
 * Route readiness is checked again at the handoff boundary. A stale area never
 * receives a Plan link, and an area owned by another city never gets its data
 * rendered under the requested city.
 */
export function resolveNightAreaActivation(
  input: ResolveNightAreaActivationInput,
): NightAreaActivationState {
  const cityId = input.cityId == null
    ? DEFAULT_CITY_ID
    : parseCityId(input.cityId);
  if (!cityId) {
    return browseState("invalid-city", DEFAULT_CITY_ID, null, null);
  }

  const normalizedSlug = input.slug?.trim().toLocaleLowerCase() ?? "";
  const area = tryGetNightArea(normalizedSlug);
  if (!area) {
    return browseState("unknown", cityId, null, humanLabelFromSlug(input.slug));
  }
  if (area.cityId !== cityId) {
    return browseState("city-mismatch", cityId, null, null);
  }
  if (!isNightAreaRouteReady(area, input.now ?? new Date())) {
    return browseState("not-ready", cityId, area, area.name);
  }

  return {
    kind: "ready",
    reason: "route-ready",
    area,
    areaName: area.name,
    cityId,
    primaryAction: {
      label: "Plan this night",
      href: planPalRouteHandoffHref(`Plan a crawl in ${area.name}`),
    },
  };
}
