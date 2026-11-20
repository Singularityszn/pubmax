import "server-only";

import { lookupUkBasePub } from "@/lib/ukBaseIndex";
import type { VenueRef } from "@/lib/venueIndex";

export async function priceAlertVenue(id: string, venues: ReadonlyMap<string, VenueRef>): Promise<VenueRef | null> {
  const curated = venues.get(id);
  if (curated) return curated.retired ? null : curated;
  if (!id.startsWith("venue-uk-")) return null;
  const result = await lookupUkBasePub(id);
  if (result.status === "unavailable") throw new Error("UK venue data is unavailable");
  if (result.status !== "ready" || result.pub.kind !== "pub") return null;
  return { id: result.pub.id, name: result.pub.name, borough: "", lat: result.pub.lat, lng: result.pub.lng, kind: "pub" };
}
