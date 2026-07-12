// Pure, client-safe logic for the first-class /tonight screen (Wave A · A2).
// Kept free of Node- and React-only imports so both the client screen and
// vitest can exercise it directly.
//
// Data source: CityMCP London `things_to_do` (via /api/citymcp/things-to-do) —
// the same live layer the Discover "Tonight nearby" lane already consumes. The
// PRD's "sport / quiz / deal / music" kinds belong to the not-yet-built
// WHATS_ON pub-event spine; the live source instead returns gig / comedy /
// theatre / exhibition / food_drink / market / nightlife / … so filter facets
// are DERIVED from whatever kinds the upstream actually returns, never a fixed
// taxonomy we might not be able to populate.

import { haversineKm } from "@/lib/haversine";
import { labelForKind, opportunityMapHref } from "@/lib/thingsToDoMap";
import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";

export type TonightOpportunity = ThingsToDoOpportunity;

// Re-export the shared helpers so the screen imports one module.
export { labelForKind, opportunityMapHref };

const OTHER_KIND = "other";

export type KindFacet = { kind: string; label: string; count: number };

/** Normalise an opportunity's kind to a non-empty slug (fallback "other"). */
export function kindSlug(op: TonightOpportunity): string {
  const raw = typeof op.kind === "string" ? op.kind.trim() : "";
  return raw.length > 0 ? raw : OTHER_KIND;
}

/**
 * Filter-chip facets derived from the kinds actually present, most common
 * first (ties broken alphabetically by label) so the chip row reflects the
 * real data rather than a fixed list we might not be able to fill.
 */
export function deriveKindFacets(ops: TonightOpportunity[]): KindFacet[] {
  const counts = new Map<string, number>();
  for (const op of ops) {
    const slug = kindSlug(op);
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const facets: KindFacet[] = [];
  for (const [kind, count] of counts) {
    facets.push({ kind, label: labelForKind(kind) ?? "Other", count });
  }
  facets.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return facets;
}

/** Rows matching the active kind, or all rows when no kind is selected. */
export function filterByKind(
  ops: TonightOpportunity[],
  activeKind: string | null,
): TonightOpportunity[] {
  if (!activeKind) return ops;
  return ops.filter((op) => kindSlug(op) === activeKind);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Honest provenance line. A valid `asOf` becomes "Checked 12 Jul" (formatted
 * from UTC parts so it never drifts by the viewer's timezone); anything
 * unparseable becomes an explicit "Freshness unknown" rather than a fabricated
 * date.
 */
export function provenanceLabel(asOf?: string | null): string {
  if (!asOf) return "Freshness unknown";
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return "Freshness unknown";
  return `Checked ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * Honest coverage summary for the header. Thin nights are labelled as thin
 * rather than dressed up; the zero case is owned by the screen's empty state.
 */
export function coverageLabel(count: number): string {
  if (count <= 0) return "Nothing confirmed tonight yet";
  if (count <= 2) return `Thin tonight — ${count} confirmed`;
  return `${count} things on tonight`;
}

type Coord = { lat: number; lng: number };

function isFiniteCoord(c: Coord | null | undefined): c is Coord {
  return (
    !!c &&
    typeof c.lat === "number" &&
    typeof c.lng === "number" &&
    Number.isFinite(c.lat) &&
    Number.isFinite(c.lng)
  );
}

// ~4.8 km/h average walking pace → km per minute.
const WALK_KM_PER_MIN = 0.08;

/**
 * Straight-line walk estimate in minutes between two points, or null when
 * either coordinate is missing / non-finite. Deliberately a haversine estimate
 * (not a per-row transit call): deterministic, testable, no N-row API fan-out,
 * and honest once labelled "~N min walk". Clamped to a minimum of 1 so a
 * co-located venue never reads "0 min".
 */
export function walkMinutes(
  from: Coord | null | undefined,
  to: Coord | null | undefined,
): number | null {
  if (!isFiniteCoord(from) || !isFiniteCoord(to)) return null;
  const km = haversineKm([from.lng, from.lat], [to.lng, to.lat]);
  return Math.max(1, Math.round(km / WALK_KM_PER_MIN));
}

/** "~12 min walk" label, or null when minutes are unknown. */
export function walkLabel(minutes: number | null): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  return `~${minutes} min walk`;
}
