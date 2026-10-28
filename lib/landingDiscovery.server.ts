import "server-only";

import type { Route } from "next";
import { loadDrinkBrandLandings } from "@/lib/drinkBrandLanding.server";

export type LandingDrinkLink = { href: Route; label: string };

/** The homepage carries a few published links, never the full price lists. */
export async function loadLandingDrinkLinks(): Promise<LandingDrinkLink[]> {
  const landings = await loadDrinkBrandLandings();
  return landings.slice(0, 3).map(({ slug, brandLabel }) => ({
    href: `/drink/${encodeURIComponent(slug)}` as Route,
    label: `${brandLabel} prices`,
  }));
}
