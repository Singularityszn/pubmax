// Loads the Shoreditch coffee pilot for the map's coffee lens: the committed
// rows, plus the London venue shards that place each cafe. Browser-only, and
// only once a reader puts the map under coffee, so a pint reader downloads
// none of it.

import {
  coffeePilotCafes,
  coffeePilotShards,
  type CoffeePilotCafe,
  type CoffeePilotRow,
} from "@/lib/coffeePilot";
import {
  parseLondonVenueManifest,
  parseLondonVenueShardForEntry,
  type LondonVenue,
} from "@/lib/londonVenueShards";

export const LONDON_VENUE_MANIFEST_PATH = "/data/london_venues/manifest.json";

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/**
 * The pilot cafes, joined to the London layer. Rejects when the layer cannot
 * be read, because a lens that drew no cafes on a failed read would say
 * Shoreditch has no listed coffee.
 */
export async function loadCoffeePilotCafes(
  fetchImpl: typeof fetch = fetch,
): Promise<CoffeePilotCafe[]> {
  const [pilot, manifestBody] = await Promise.all([
    import("@/data/coffee_pilot/shoreditch.json"),
    fetchJson(fetchImpl, LONDON_VENUE_MANIFEST_PATH),
  ]);
  const manifest = parseLondonVenueManifest(manifestBody);
  if (!manifest) throw new Error("London venue manifest is malformed");
  const shards = await Promise.all(
    coffeePilotShards(manifest.shards).map(async (entry): Promise<LondonVenue[]> => {
      const shard = parseLondonVenueShardForEntry(await fetchJson(fetchImpl, entry.url), entry);
      if (!shard) throw new Error(`London venue shard ${entry.id} is malformed`);
      return shard;
    }),
  );
  return coffeePilotCafes(pilot.default.rows as readonly CoffeePilotRow[], shards.flat());
}
