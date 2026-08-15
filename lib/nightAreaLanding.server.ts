import "server-only";

import {
  buildNightAreaLanding,
  listNightAreaLandings,
  type NightAreaLanding,
} from "@/lib/nightAreaLanding";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";

export async function loadNightAreaLandings(now = new Date()): Promise<NightAreaLanding[]> {
  return listNightAreaLandings(await loadPintPriceLandingVenues(), NIGHT_AREAS, now);
}

export async function loadNightAreaLanding(
  slug: string,
  now = new Date(),
): Promise<NightAreaLanding | null> {
  const area = NIGHT_AREAS.find((candidate) => candidate.slug === slug);
  if (!area) return null;
  return buildNightAreaLanding(area, await loadPintPriceLandingVenues(), NIGHT_AREAS, now);
}
