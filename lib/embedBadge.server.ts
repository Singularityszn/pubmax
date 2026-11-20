import "server-only";

import { canonicalBorough, LONDON_BOROUGHS, slugifyBorough } from "@/lib/boroughs";
import { loadLondonHuntPintsOrNull } from "@/lib/cheapestHunt.server";
import { getPricedVenues } from "@/lib/venuePriceIndex";

export type EmbedBadge = {
  title: string;
  pubName: string;
  priceGbp: number;
  publisher: string;
  observedOn: string;
};

export async function readBadge(kind: string, id: string): Promise<EmbedBadge | null> {
  if ((kind !== "area" && kind !== "venue") || !/^[a-z0-9-]{1,120}$/.test(id)) return null;
  const area = kind === "area" ? LONDON_BOROUGHS.find((name) => slugifyBorough(name) === id) : null;
  if (kind === "area" && !area) return null;
  const [pints, venues] = await Promise.all([loadLondonHuntPintsOrNull(), getPricedVenues()]);
  if (!pints) throw new Error("Badge prices unavailable");
  const ids = kind === "area"
    ? new Set(venues.filter((venue) => canonicalBorough(venue) === area).map((venue) => venue.id))
    : new Set([id]);
  const pint = pints.find((entry) => ids.has(entry.venueId));
  if (!pint) return null;
  return {
    title: area ? `Cheapest pint we found in ${area}` : "Cheapest pint we found here",
    pubName: pint.pubName,
    priceGbp: pint.priceGbp,
    publisher: pint.publisher.label,
    observedOn: pint.observedOn,
  };
}
