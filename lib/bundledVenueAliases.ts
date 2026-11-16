import london from "@/public/data/venue_id_aliases.json";
import cities from "@/public/data/cities/venue_id_aliases.json";
import ukBase from "@/public/data/uk_base_venue_id_aliases.json";
import { flattenVenueAliasChains } from "@/lib/venueAliasesFile.mjs";

const aliases = flattenVenueAliasChains([
  ...Object.entries(london.aliases),
  ...Object.entries(cities.aliases),
  ...Object.entries(ukBase.aliases),
]);

export function canonicalBundledVenueId(id: string): string {
  return aliases.get(id) ?? id;
}
