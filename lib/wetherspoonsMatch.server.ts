import { readFile } from "node:fs/promises";
import path from "node:path";

import { haversineKm } from "@/lib/haversine";
import type { WetherspoonsPub } from "@/lib/wetherspoonsDirectory";

/** Venue shape needed to join the first-party Wetherspoon directory. */
export type WetherspoonsMatchVenue = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

/** Exact normalised name + 250 m; shared by opening evidence and plan ranking. */
export const WETHERSPOONS_MATCH_MAX_KM = 0.25;

export function normalizeWetherspoonsMatchName(value: string): string {
  return value.toLocaleLowerCase("en-GB").normalize("NFKD")
    .replace(/[’']/g, "").replace(/\([^)]*\)/g, " ")
    .replace(/\bjd wetherspoons?\b/g, " ").replace(/[^a-z0-9]+/g, " ")
    .trim().replace(/^the\s+/, "");
}

let directoryPubs: Promise<WetherspoonsPub[]> | null = null;

export async function loadWetherspoonsDirectoryPubs(): Promise<WetherspoonsPub[]> {
  directoryPubs ??= (async () => {
    try {
      const raw = JSON.parse(
        await readFile(path.join(process.cwd(), "public/data/wetherspoons/pubs.json"), "utf8"),
      ) as { pubs?: unknown };
      return Array.isArray(raw.pubs) ? raw.pubs as WetherspoonsPub[] : [];
    } catch {
      return [];
    }
  })();
  return directoryPubs;
}

/** Closest first-party directory row for a venue, or null when name/coords disagree. */
export function matchWetherspoonsDirectoryPub(
  venue: Omit<WetherspoonsMatchVenue, "id">,
  pubs: readonly WetherspoonsPub[],
): WetherspoonsPub | null {
  const venueName = normalizeWetherspoonsMatchName(venue.name);
  if (!venueName) return null;
  return pubs
    .filter((pub) => normalizeWetherspoonsMatchName(pub.name) === venueName)
    .filter((pub) => typeof pub.latitude === "number" && typeof pub.longitude === "number")
    .map((pub) => ({
      pub,
      distance: haversineKm([venue.lng, venue.lat], [pub.longitude!, pub.latitude!]),
    }))
    .filter(({ distance }) => distance <= WETHERSPOONS_MATCH_MAX_KM)
    .sort((left, right) => left.distance - right.distance)[0]?.pub ?? null;
}

/** Venue ids that join the first-party directory under the shared name+distance rule. */
export async function matchedWetherspoonsVenueIds(
  venues: readonly WetherspoonsMatchVenue[],
): Promise<ReadonlySet<string>> {
  const pubs = await loadWetherspoonsDirectoryPubs();
  const matched = new Set<string>();
  for (const venue of venues) {
    if (matchWetherspoonsDirectoryPub(venue, pubs)) matched.add(venue.id);
  }
  return matched;
}
