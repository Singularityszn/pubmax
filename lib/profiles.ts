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
  // A period label ("Victorian", "1980s"…) when the memory is pinned to an era.
  // Used by computeBadges to award the Heritage Walker badge.
  era?: string | null;
  // Where the drop came from. An "anecdote" is a passed-down memory (heritage
  // signal); "sourced"/"contributor"/"demo" are not. See lib/curation.ts.
  provenance?: string | null;
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
  // How many crawls this handle has posted. There's no crawl-authorship data on
  // this page yet, so callers pass it in explicitly; it defaults to 0 and is
  // always a finite, non-negative integer.
  crawlsPosted: number;
  boroughs?: string[];
};

// An earned-or-not achievement badge. Pure data — the UI decides how to render.
// `earned` lets callers keep the full catalogue (for a "locked" preview) or
// filter to just the earned set; computeBadges returns the whole catalogue.
export type Badge = {
  id: string;
  label: string;
  description: string;
  earned: boolean;
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
// - crawlsPosted is passed in (this page has no crawl-authorship data), coerced
//   to a finite, non-negative integer; junk / missing → 0.
// - boroughs is a sorted unique list, OMITTED entirely when no drop names one.
export function profileStats(
  drops: readonly ProfileDrop[] | null | undefined,
  crawlsPosted?: number | null,
): ProfileStats {
  const list = Array.isArray(drops) ? drops : [];

  const prices = list
    .map((d) => d.priceGbp)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p) && p > 0);
  const cheapestPintGbp = prices.length ? Math.min(...prices) : null;

  const crawls =
    typeof crawlsPosted === "number" && Number.isFinite(crawlsPosted) && crawlsPosted > 0
      ? Math.floor(crawlsPosted)
      : 0;

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
    crawlsPosted: crawls,
  };
  if (boroughs.length) stats.boroughs = boroughs;
  return stats;
}

// Pint tiers for the "regular → local legend" ladder. A drinker becomes a
// Regular at 25 logged pints and a Local Legend at 100 — round, aspirational
// numbers that stay reachable in the demo while still marking a milestone.
export const REGULAR_THRESHOLD = 25;
export const LOCAL_LEGEND_THRESHOLD = 100;

// Under this price a pint is a genuine bargain worth a badge. Strictly under —
// £4.00 exactly is not "under £4", so it does NOT earn Cheap Legend.
const CHEAP_LEGEND_MAX_GBP = 4;

// Provenance values that mark a drop as a passed-down memory (a heritage
// signal), as opposed to a live/sourced/seeded log.
const HERITAGE_PROVENANCE = new Set(["anecdote", "heritage"]);

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Pure, deterministic badge catalogue for a handle. Turns activity into
// identity (the Letterboxd pattern): each badge is returned with `earned` so
// the UI can either show the full ladder or filter to the earned set. Never
// throws — a null/empty drop list yields the catalogue with everything unearned.
//
// Badges:
//  • First Pint      — ≥1 drop logged.
//  • Cheap Legend    — any drop priced strictly under £4.
//  • Heritage Walker — any drop carrying an era, or an anecdote/heritage
//                      provenance (a passed-down memory).
//  • Regular         — ≥25 pints logged.
//  • Local Legend    — ≥100 pints logged.
export function computeBadges(
  drops: readonly ProfileDrop[] | null | undefined,
  stats: ProfileStats,
): Badge[] {
  const list = Array.isArray(drops) ? drops : [];
  const pints = stats.pintsLogged;

  const cheapLegend = list.some(
    (d) =>
      typeof d.priceGbp === "number" &&
      Number.isFinite(d.priceGbp) &&
      d.priceGbp > 0 &&
      d.priceGbp < CHEAP_LEGEND_MAX_GBP,
  );

  const heritageWalker = list.some(
    (d) =>
      hasText(d.era) ||
      (hasText(d.provenance) && HERITAGE_PROVENANCE.has(d.provenance.trim().toLowerCase())),
  );

  return [
    {
      id: "first-pint",
      label: "First Pint",
      description: "Logged your first Pint Drop.",
      earned: pints >= 1,
    },
    {
      id: "cheap-legend",
      label: "Cheap Legend",
      description: "Found a pint under £4.",
      earned: cheapLegend,
    },
    {
      id: "heritage-walker",
      label: "Heritage Walker",
      description: "Logged a pint tied to an era or a passed-down memory.",
      earned: heritageWalker,
    },
    {
      id: "regular",
      label: "Regular",
      description: `Logged ${REGULAR_THRESHOLD}+ pints.`,
      earned: pints >= REGULAR_THRESHOLD,
    },
    {
      id: "local-legend",
      label: "Local Legend",
      description: `Logged ${LOCAL_LEGEND_THRESHOLD}+ pints.`,
      earned: pints >= LOCAL_LEGEND_THRESHOLD,
    },
  ];
}

// Progress toward one unearned badge — pure data for a "quest chip". `current`
// and `target` are honest counts (a binary badge like Cheap Legend is a 0-of-1
// action, not a fake percentage); `label` is ready-to-render honest copy.
export type BadgeProgress = {
  badge: Badge;
  current: number;
  target: number;
  label: string;
};

// Forward-looking companion to computeBadges (IDEAS B2-lite quest chips): the
// UNEARNED badges, nearest-first, each with progress toward its threshold.
// Same inputs as computeBadges, pure and deterministic:
//  • "nearest" = highest current/target completion; ties keep catalogue order.
//  • Count badges (First Pint, Regular, Local Legend) report real pint counts.
//  • Binary badges (Cheap Legend, Heritage Walker) are 0-of-1 with an action
//    label — no invented percentages.
//  • Zero stats → the full catalogue, all at zero (First Pint leads).
//  • Everything earned → an empty array; the caller renders nothing.
export function nextBadgeProgress(
  drops: readonly ProfileDrop[] | null | undefined,
  stats: ProfileStats,
): BadgeProgress[] {
  const pints =
    typeof stats.pintsLogged === "number" && Number.isFinite(stats.pintsLogged) && stats.pintsLogged > 0
      ? Math.floor(stats.pintsLogged)
      : 0;

  // Per-badge quest shape: the threshold plus honest copy for the chip.
  const quests: Record<string, { current: number; target: number; label: string }> = {
    "first-pint": {
      current: Math.min(pints, 1),
      target: 1,
      label: "Log your first pint for First Pint",
    },
    "cheap-legend": {
      current: 0, // unearned means the sub-£4 pint hasn't happened yet
      target: 1,
      label: "Find a pint under £4 for Cheap Legend",
    },
    "heritage-walker": {
      current: 0, // unearned means no era / passed-down memory yet
      target: 1,
      label: "Log an era or passed-down memory for Heritage Walker",
    },
    regular: {
      current: Math.min(pints, REGULAR_THRESHOLD),
      target: REGULAR_THRESHOLD,
      label: `${Math.min(pints, REGULAR_THRESHOLD)} of ${REGULAR_THRESHOLD} pints to Regular`,
    },
    "local-legend": {
      current: Math.min(pints, LOCAL_LEGEND_THRESHOLD),
      target: LOCAL_LEGEND_THRESHOLD,
      label: `${Math.min(pints, LOCAL_LEGEND_THRESHOLD)} of ${LOCAL_LEGEND_THRESHOLD} pints to Local Legend`,
    },
  };

  const progress = computeBadges(drops, stats)
    .filter((badge) => !badge.earned)
    .map((badge, index) => {
      const quest = quests[badge.id] ?? { current: 0, target: 1, label: badge.description };
      return { badge, index, ...quest };
    });

  // Nearest-first by completion ratio; catalogue order breaks ties so the
  // result is stable and deterministic.
  progress.sort((a, b) => {
    const ratio = b.current / b.target - a.current / a.target;
    return ratio !== 0 ? Math.sign(ratio) : a.index - b.index;
  });

  return progress.map(({ badge, current, target, label }) => ({ badge, current, target, label }));
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
