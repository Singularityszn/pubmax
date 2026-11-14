import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { getCity, type CityId } from "@/lib/cities";
import type { ConciergeVenue, DatedVenueFact } from "@/lib/concierge/rank";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import { displayVenueName, venueSourceNameField } from "@/lib/venueDisplay";

type SlimRow = Record<string, unknown>;

const cache = new Map<CityId, ConciergeVenue[]>();
const inflight = new Map<CityId, Promise<ConciergeVenue[]>>();

function bool(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function optionalBool(record: Record<string, unknown>, key: string): boolean | undefined {
  return typeof record[key] === "boolean" ? record[key] as boolean : undefined;
}

/** A `[true, source, YYYY-MM-DD]` hint from the slim builder. Anything else is not a fact. */
function datedTrueFact(value: unknown): DatedVenueFact | undefined {
  if (!Array.isArray(value) || value[0] !== true) return undefined;
  const [, source, observedAt] = value;
  if (typeof source !== "string" || !source.trim() || typeof observedAt !== "string") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedAt) || !Number.isFinite(Date.parse(observedAt))) return undefined;
  return { source: source.trim(), observedAt };
}

function amenityFlags(amenities: Record<string, unknown>): ConciergeVenue["amenities"] {
  const nonAlcoholic = optionalBool(amenities, "nonAlcoholic");
  return {
    beerGarden: bool(amenities, "beerGarden"),
    cocktails: bool(amenities, "cocktails"),
    food: bool(amenities, "food"),
    liveSports: bool(amenities, "liveSports"),
    liveMusic: bool(amenities, "liveMusic"),
    ...(nonAlcoholic === undefined ? {} : { nonAlcoholic }),
    ...(bool(amenities, "darts") ? { darts: true } : {}),
    ...(bool(amenities, "pool") ? { pool: true } : {}),
  };
}

function features(hints: Record<string, unknown>): Pick<ConciergeVenue, "features"> {
  const garden = datedTrueFact(hints.beerGardenSource);
  const outdoorSeating = datedTrueFact(hints.outdoorSeating);
  const dogsWelcome = datedTrueFact(hints.dogsWelcome);
  if (!garden && !outdoorSeating && !dogsWelcome) return {};
  return {
    features: {
      ...(garden ? { garden } : {}),
      ...(outdoorSeating ? { outdoorSeating } : {}),
      ...(dogsWelcome ? { dogsWelcome } : {}),
    },
  };
}

function pintEvidence(row: SlimRow): Pick<ConciergeVenue, "priceSource" | "priceObservedAt" | "anchorLabel" | "cheapestPint" | "measure"> {
  return {
    ...(typeof row.priceSource === "string" ? { priceSource: row.priceSource } : {}),
    ...(typeof row.priceObservedAt === "string" ? { priceObservedAt: row.priceObservedAt } : {}),
    ...(typeof row.anchorLabel === "string" ? { anchorLabel: row.anchorLabel } : {}),
    ...(typeof row.cheapestPint === "string" ? { cheapestPint: row.cheapestPint } : {}),
    ...(typeof row.measure === "string" ? { measure: row.measure } : {}),
  };
}

function toVenue(value: unknown): ConciergeVenue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as SlimRow;
  if (typeof row.id !== "string" || !row.id || typeof row.name !== "string" || !row.name) return null;
  // Non-pub venues carry type-specific anchor prices (a cocktail, a doner),
  // not pint prices. Concierge/plan surfaces reason in pints, so they must
  // never see these rows.
  if (row.kind !== undefined && row.kind !== "pub") return null;
  if (typeof row.lat !== "number" || !Number.isFinite(row.lat) || typeof row.lng !== "number" || !Number.isFinite(row.lng)) return null;
  if (typeof row.borough !== "string") return null;
  if (row.cheapestPrice !== null && (typeof row.cheapestPrice !== "number" || !Number.isFinite(row.cheapestPrice))) return null;
  const hints = row.filterHints && typeof row.filterHints === "object" && !Array.isArray(row.filterHints)
    ? row.filterHints as Record<string, unknown>
    : {};
  const amenities = hints.amenities && typeof hints.amenities === "object" && !Array.isArray(hints.amenities)
    ? hints.amenities as Record<string, unknown>
    : {};
  const curation = hints.curation && typeof hints.curation === "object" && !Array.isArray(hints.curation)
    ? hints.curation as Record<string, unknown>
    : {};
  return {
    id: row.id,
    name: displayVenueName(row.name),
    ...venueSourceNameField(row.name),
    area: row.borough,
    lat: row.lat,
    lng: row.lng,
    cheapestPrice: row.cheapestPrice as number | null,
    ...(typeof row.zone === "number" && Number.isFinite(row.zone) ? { zone: row.zone } : {}),
    ...pintEvidence(row),
    amenities: amenityFlags(amenities),
    ...features(hints),
    nearWater: bool(curation, "nearWater"),
    hasStory: bool(curation, "hasStory"),
    canonical: hints.canonical === true,
    ...(typeof hints.searchText === "string" ? { searchText: hints.searchText } : {}),
    ...(typeof hints.drinkText === "string" ? { drinkText: hints.drinkText } : {}),
    // Future datasets may carry placements. Preserve only the exclusion flag;
    // never pass placement metadata into ranking or the response.
    ...(row.promoted === true || hints.promoted === true ? { promoted: true } : {}),
  };
}

/** Read and defensively normalise the server-owned city venue index. */
export async function loadConciergeVenues(cityId: CityId): Promise<ConciergeVenue[]> {
  const hit = cache.get(cityId);
  if (hit) return hit;
  const pending = inflight.get(cityId);
  if (pending) return pending;

  const load = (async () => {
    try {
      const publicPath = getCity(cityId).slimVenuesPath.replace(/^\//, "");
      const raw = await readFile(
        path.join(
          /* turbopackIgnore: true */ process.cwd(),
          "public",
          publicPath,
        ),
        "utf8",
      );
      const parsed: unknown = JSON.parse(raw);
      const rows = rowsFromSlimPayload(parsed) ?? [];
      const venues = rows.map(toVenue).filter((venue): venue is ConciergeVenue => venue !== null);
      cache.set(cityId, venues);
      return venues;
    } catch {
      // Missing/corrupt data must degrade to an honest empty result, never 500.
      return [];
    }
  })();
  inflight.set(cityId, load);
  try {
    return await load;
  } finally {
    if (inflight.get(cityId) === load) inflight.delete(cityId);
  }
}
