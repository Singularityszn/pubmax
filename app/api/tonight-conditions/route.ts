// GET /api/tonight-conditions?lat=..&lng=..  →  { summary: TonightConditionsSummary | null }
//
// The server half of the Tonight Conditions strip. Reads the cached night-area
// weather snapshot (public/data/weather/latest.json, the same seam the plan
// generator consumes), runs the pure drink-weather rules, and — when the viewer
// shares a rough location — counts nearby venues matching the verdict's lens
// from the bundled venue index (beer gardens via the amenity flag, riverside via
// the nearWater curation flag) with a pint under the price ceiling.
//
// lat/lng are OPTIONAL. Without them we still answer with the date, weather and
// drink line for a sensible central area, just no "near you" venue claim. The
// route never throws and never 500s: any missing or malformed data degrades to
// { summary: null } and the strip renders nothing.

import { jsonNoStore } from "@/lib/apiResponses";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import {
  getNightArea,
  nearestNightAreaForViewport,
  type NightAreaSlug,
} from "@/lib/nightAreas";
import { planningWeatherForArea } from "@/lib/weatherSnapshots";
import { evaluateDrinkWeather } from "@/lib/drinkWeather";
import {
  lensVenuePredicate,
  londonMonth,
  summariseTonightConditions,
  tallyLensMatches,
  type VenueLensTally,
} from "@/lib/tonightConditions";
import weatherSnapshot from "@/public/data/weather/latest.json";

// Fallback area when the viewer shares no location: a dense central district
// with route-ready coverage. Weather still answers; no venue claim is made.
const DEFAULT_AREA: NightAreaSlug = "piccadilly-soho";

function finiteCoord(value: string | null, min: number, max: number): number | null {
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const lat = finiteCoord(url.searchParams.get("lat"), -90, 90);
    const lng = finiteCoord(url.searchParams.get("lng"), -180, 180);
    const point: [number, number] | null = lat !== null && lng !== null ? [lng, lat] : null;

    const area = point
      ? nearestNightAreaForViewport(DEFAULT_CITY_ID, point)
      : getNightArea(DEFAULT_AREA);
    if (!area) return jsonNoStore({ summary: null });

    const now = new Date();
    const weather = planningWeatherForArea(weatherSnapshot, area.slug, now.getTime());
    if (!weather) return jsonNoStore({ summary: null });

    const conditionsWeather = {
      tempC: weather.feelsLikeC,
      condition: weather.condition,
      precipitationProbabilityPct: weather.precipitationProbabilityPct,
    };

    // Resolve the lens once so we only load the venue index when a claim is
    // possible (a garden or riverside verdict with a shared location).
    const verdict = evaluateDrinkWeather({
      tempC: conditionsWeather.tempC,
      precipitationProbabilityPct: conditionsWeather.precipitationProbabilityPct,
      month: londonMonth(now),
    });
    if (!verdict) return jsonNoStore({ summary: null });

    let tally: VenueLensTally = null;
    if (point && lensVenuePredicate(verdict.venueLens)) {
      try {
        const venues = await loadConciergeVenues(DEFAULT_CITY_ID);
        tally = tallyLensMatches(venues, verdict.venueLens, point);
      } catch {
        tally = null;
      }
    }

    const summary = summariseTonightConditions({ weather: conditionsWeather, now, tally });
    return jsonNoStore({ summary });
  } catch {
    // The strip is an optional extra; a failure here must never break the page.
    return jsonNoStore({ summary: null });
  }
}
