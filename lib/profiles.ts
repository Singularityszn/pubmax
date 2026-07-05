// Demo profile model + pure helpers for public profiles (/u/[handle]).
//
// Handle-based identity is a DEMO stance: there is no auth or stored profile
// table yet (real Supabase Auth is a later epic). A profile is therefore
// SYNTHESIZED from a handle's public Pint Drops — display name from the handle,
// simple stats from the drops. Everything here is pure and backend-free so it
// unit-tests without a DOM, a network, or a database.

// A profile drop is the public Pint Drop DTO shape, kept loose so this module
// never depends on the store's internal types. Only the fields the profile
// actually reads are named; unknown extras (era, note, photos, provenance...)
// ride along untouched.
export type ProfileDrop = {
  handle: string;
  priceGbp?: number | null;
  venueId?: string;
  // Forward-compatible: drops don't carry a borough today, but if a future DTO
  // does, profileStats surfaces it. Absent → boroughs is omitted, never [].
  borough?: string | null;
  [key: string]: unknown;
};

export type Profile = {
  handle: string;
  displayName: string;
  homeCity?: string;
  bio?: string;
  avatarUrl?: string;
};

export type ProfileStats = {
  pintsLogged: number;
  // Cheapest priced pint in GBP, or null when the handle has no priced drops
  // (notes-only / anecdote drops carry a null price).
  cheapestPintGbp: number | null;
  boroughs?: string[];
};

// Handles are the identity primitive, so normalization is strict and total:
// lowercase, drop a single leading "@", keep only [a-z0-9_], cap the length.
// Never throws — junk in yields a (possibly empty) safe handle out.
const HANDLE_MAX = 30;

export function normalizeHandle(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, "") // strip leading @ (one or many)
    .replace(/[^a-z0-9_]/g, "") // keep only the handle alphabet
    .slice(0, HANDLE_MAX);
}

// Turn a normalized handle into a friendly display name for the demo. We split
// on underscores and title-case the words: "cheap_pint_ken" → "Cheap Pint Ken".
// A handle that normalizes to empty falls back to a stable placeholder.
function displayNameFromHandle(handle: string): string {
  const words = handle
    .split("_")
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length ? words.join(" ") : "Anonymous Drinker";
}

// Pure stats over a handle's drops. Order-independent and null-safe:
// - pintsLogged is the number of drops.
// - cheapestPintGbp is the min of finite, positive prices, or null when none.
// - boroughs is a sorted unique list, OMITTED entirely when no drop names one.
export function profileStats(drops: readonly ProfileDrop[] | null | undefined): ProfileStats {
  const list = Array.isArray(drops) ? drops : [];

  const prices = list
    .map((d) => d.priceGbp)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p) && p > 0);
  const cheapestPintGbp = prices.length ? Math.min(...prices) : null;

  const boroughs = Array.from(
    new Set(
      list
        .map((d) => (typeof d.borough === "string" ? d.borough.trim() : ""))
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const stats: ProfileStats = {
    pintsLogged: list.length,
    cheapestPintGbp,
  };
  if (boroughs.length) stats.boroughs = boroughs;
  return stats;
}

// Synthesize a demo Profile for a handle from its drops. There is no stored
// profile, so the display name comes from the handle and the bio is a light
// summary derived from the stats. Callers pass the handle they already
// normalized; we normalize again defensively so this is safe standalone.
export function deriveProfileFromDrops(
  rawHandle: string,
  drops: readonly ProfileDrop[] | null | undefined,
): Profile {
  const handle = normalizeHandle(rawHandle);
  const stats = profileStats(drops);

  const bio = stats.pintsLogged
    ? `${stats.pintsLogged} ${stats.pintsLogged === 1 ? "pint" : "pints"} logged` +
      (stats.cheapestPintGbp != null
        ? ` · cheapest £${stats.cheapestPintGbp.toFixed(2)}`
        : "")
    : undefined;

  return {
    handle,
    displayName: displayNameFromHandle(handle),
    bio,
  };
}
