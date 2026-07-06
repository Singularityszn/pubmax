import type { Venue } from "@/lib/venues";
import { venueArea } from "@/lib/leaderboard";

// Pure, deterministic helpers behind the borough discovery pages (cc_plan2
// §14/§25). Locals talk about pubs by area — Camden, Soho, Hackney — so each
// borough gets a server-rendered, shareable page. Everything here is a plain
// transform over a Venue[] (no fetch, no React, no side effects) so it can be
// unit-tested directly against tiny fixtures (see __tests__/boroughs.test.ts).
//
// The borough name is resolved through leaderboard.venueArea, which already
// carries the app's canonical primaryBorough → visibleBorough → UNKNOWN_AREA
// fallback, so a sparse row is grouped, never dropped.

export type BoroughSummary = {
  slug: string;
  name: string;
  pubCount: number;
  // The cheapest pint in the borough, in GBP, or null when no pub there carries
  // a usable price (so the page can render "—" instead of crashing).
  cheapestGbp: number | null;
};

// Kebab-case a borough name for the URL: "City of London" → "city-of-london",
// "Kensington & Chelsea" → "kensington-chelsea". Lowercased, non-alphanumerics
// collapse to single hyphens, and leading/trailing hyphens are trimmed. Empty
// or symbol-only input yields "" so callers can guard against it.
export function slugifyBorough(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Reverse a slug back to a real borough name by matching against the boroughs
// actually present in the dataset (slug equality is exact, case-insensitive).
// Returns the canonical display name, or null for a slug no borough produces —
// the page turns that null into notFound(). Reversing through the live index
// (rather than de-kebabing the string) keeps "&"/casing/"City of London"
// exactly as the data spells them.
export function boroughFromSlug(slug: string, venues: Venue[]): string | null {
  const target = slugifyBorough(slug);
  if (!target) return null;
  for (const name of boroughNames(venues)) {
    if (slugifyBorough(name) === target) return name;
  }
  return null;
}

// The distinct borough display names present in the dataset, in first-seen
// order. Deduped case-insensitively by slug so "Camden"/"camden" don't split.
function boroughNames(venues: Venue[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const venue of venues) {
    const name = venueArea(venue);
    const key = slugifyBorough(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

// All boroughs as summaries for the index page: name, how many pubs sit in it,
// and its cheapest pint. Sorted by pubCount descending (busiest areas lead),
// ties broken on name so the order is deterministic across renders.
export function listBoroughs(venues: Venue[]): BoroughSummary[] {
  const byKey = new Map<
    string,
    { name: string; pubCount: number; cheapestGbp: number | null }
  >();

  for (const venue of venues) {
    const name = venueArea(venue);
    const slug = slugifyBorough(name);
    if (!slug) continue;
    const entry = byKey.get(slug) ?? { name, pubCount: 0, cheapestGbp: null };
    entry.pubCount += 1;
    const price = venue.cheapestPrice;
    if (typeof price === "number") {
      entry.cheapestGbp =
        entry.cheapestGbp === null ? price : Math.min(entry.cheapestGbp, price);
    }
    byKey.set(slug, entry);
  }

  return Array.from(byKey.entries())
    .map(([slug, entry]) => ({ slug, ...entry }))
    .sort((a, b) => b.pubCount - a.pubCount || a.name.localeCompare(b.name));
}

// The venues in one borough, cheapest-first. `slug` is matched through
// slugifyBorough so it accepts the URL form directly. Priced pubs lead in
// ascending price order; unpriced pubs fall to the end (name-sorted). Ties on
// price break on name so the order is deterministic. An unknown/empty slug
// yields [] — the page renders an empty state, never a 500.
export function pubsInBorough(venues: Venue[], slug: string): Venue[] {
  const target = slugifyBorough(slug);
  if (!target) return [];
  return venues
    .filter((venue) => slugifyBorough(venueArea(venue)) === target)
    .sort((a, b) => {
      const left = a.cheapestPrice ?? Number.POSITIVE_INFINITY;
      const right = b.cheapestPrice ?? Number.POSITIVE_INFINITY;
      return left - right || a.name.localeCompare(b.name);
    });
}
