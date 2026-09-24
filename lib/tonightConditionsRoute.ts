import { DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import {
  getNightArea,
  nearestNightAreaForViewport,
  type NightAreaSlug,
} from "@/lib/nightAreas";
import { latestWeatherForArea } from "@/lib/weatherSnapshots";
import { loadFreshWeatherSnapshot } from "@/lib/weatherFreshness.server";
import { evaluateDrinkWeather } from "@/lib/drinkWeather";
import {
  lensVenuePredicate,
  londonMonth,
  summariseTonightConditions,
  tallyLensMatches,
  type TonightConditionsSummary,
  type VenueLensTally,
} from "@/lib/tonightConditions";

const DEFAULT_AREA: NightAreaSlug = "piccadilly-soho";

export type ResolveConditionsOptions = {
  point: [number, number] | null;
  now: Date;
  snapshot?: unknown;
  loadVenues?: (cityId: CityId) => Promise<ConciergeVenue[]>;
};

export async function resolveTonightConditions(
  options: ResolveConditionsOptions,
): Promise<TonightConditionsSummary | null> {
  const { point, now } = options;
  const snapshot =
    options.snapshot ?? (await loadFreshWeatherSnapshot({ now }).catch(() => null));
  const loadVenues = options.loadVenues ?? loadConciergeVenues;
  const area = point
    ? nearestNightAreaForViewport(DEFAULT_CITY_ID, point)
    : getNightArea(DEFAULT_AREA);
  if (!area || !snapshot) return null;

  const read = latestWeatherForArea(snapshot, area.slug, now.getTime());
  if (!read) return null;
  const { observation, stale } = read;
  const conditionsWeather = {
    tempC: observation.feelsLikeC,
    condition: observation.condition,
    precipitationProbabilityPct: observation.precipitationProbabilityPct,
    windKph: observation.windKph,
    isDay: observation.isDay,
    sunsetAt: observation.sunsetAt,
  };
  const verdict = evaluateDrinkWeather({
    tempC: conditionsWeather.tempC,
    precipitationProbabilityPct: conditionsWeather.precipitationProbabilityPct,
    month: londonMonth(now),
    isDay: conditionsWeather.isDay,
  });
  if (!verdict) return null;

  let tally: VenueLensTally = null;
  if (point && lensVenuePredicate(verdict.venueLens)) {
    try {
      const venues = await loadVenues(DEFAULT_CITY_ID);
      tally = tallyLensMatches(venues, verdict.venueLens, point);
    } catch {
      tally = null;
    }
  }
  return summariseTonightConditions({ weather: conditionsWeather, now, tally, stale });
}
