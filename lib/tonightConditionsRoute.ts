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
import { daylightForNightArea } from "@/lib/weatherDaylight";
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
    isDay: null,
    sunsetAt: null,
  };

  if (stale) {
    return summariseTonightConditions({
      weather: conditionsWeather,
      now,
      tally: null,
      stale: true,
      nightArea: area.slug,
      factsAt: new Date(observation.observedAt),
    });
  }

  const daylight = daylightForNightArea(area.slug, now);
  const isDay = daylight?.isDay ?? null;
  const sunsetAt = daylight ? daylight.sunsetAt.toISOString() : null;
  const weatherForVerdict = { ...conditionsWeather, isDay, sunsetAt };
  const verdict = evaluateDrinkWeather({
    tempC: weatherForVerdict.tempC,
    precipitationProbabilityPct: weatherForVerdict.precipitationProbabilityPct,
    month: londonMonth(now),
    isDay,
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
  return summariseTonightConditions({
    weather: weatherForVerdict,
    now,
    tally,
    stale: false,
    nightArea: area.slug,
  });
}
