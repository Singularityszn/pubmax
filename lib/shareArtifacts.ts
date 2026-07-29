import { formatSavedVenueCount } from "@/lib/savedListPresentation";

// WhatsApp-native share artifacts — one pure text builder per shareable night
// object (Cycle 2 decision 5 / Wave C in fable-implement-prd.md). Every object
// that can leave the site as a group-chat message builds its copy HERE, so the
// tone, honesty rules, and wa.me idiom can never drift between call sites.
//
// Rules (mirroring lib/tfl.ts's buildLastPintShareText on the guardian lane):
// - Pure functions only — no window, no navigator, no Date.now. Call sites own
//   URL resolution and the share-sheet/wa.me plumbing (ShareBar, useVenueShare).
// - Honest data only. A missing price, start time, or count is OMITTED, never
//   invented or padded with placeholders.
// - WhatsApp-first tone: short single-message copy that reads like a mate
//   texting the group, closed with the brand line where the object is a story
//   artifact ("Every pint has a story.").
//
// Current shareable night objects (audit, 2026-07-17) — every call site now
// builds its message here:
//   plan invite  app/plan/[id]        → ShareBar (via shareCopyForPlan)
//   pint drop    app/p/[id] + FeedCard → ShareBar (one builder, both cards)
//   crawl story  app/crawls/[slug]    → ShareBar
//   bar tab      app/bar-tab/[id]     → ShareBar
//   venue        map VenueInspector   → useVenueShare
//   passport     PintPassport         → ShareBar
//   saved list   SavedListDetail      → ShareBar
//   historic pub app/historic/[slug]  → ShareBar
//
// Delivery plumbing is unified in lib/shareSheet.ts (native sheet first,
// wa.me fallback); ShareBar leads with the native button for the same reason.
//
// OG cards: every shared URL now carries one — /p/[id], /historic/[slug],
// /u/[handle] (+ saved lists via /api/list-card), plan via /api/plan-card,
// crawl via /api/crawl-card + /api/chaos-card, venue via the map/city cards,
// and bar tab via app/bar-tab/[id]/opengraph-image.tsx (ogBrand kit).

// £-formatting shared by every builder: only a real, positive, finite number
// becomes a price string — anything else is treated as "price unknown".
function gbp(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `£${value.toFixed(2)}`
    : null;
}

// "3 stops" / "1 stop" — counts are always honest integers at the call sites.
function countNoun(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// ── Plan invite ──────────────────────────────────────────────────────────────

export type PlanInviteShareInput = {
  title: string;
  stopCount: number;
  // Pre-formatted London wall clock ("19:00") from planPresentation's
  // startLabel — null when the start time didn't parse (never guessed here).
  startClock?: string | null;
};

export function buildPlanInviteShareText(input: PlanInviteShareInput): string {
  const { title, stopCount, startClock } = input;
  const parts = [title, countNoun(stopCount, "stop")];
  if (startClock) parts.push(`starts ${startClock}`);
  return `${parts.join(" · ")}. Open the link and tap I'm in.`;
}

// ── Pint drop (permalink card + feed card share the same message) ────────────

export type PintDropShareInput = {
  venueName: string;
  priceGbp?: number | null;
  // Display handle ("@old_ken" already resolved by the call site). Omitted on
  // the drinker's own permalink where "Logged a pint…" reads first-person.
  handle?: string | null;
};

export function buildPintDropShareText(input: PintDropShareInput): string {
  const { venueName, handle } = input;
  const price = gbp(input.priceGbp);
  const opener = handle
    ? `${handle} logged a pint at ${venueName}`
    : `Logged a pint at ${venueName}`;
  return `${opener}${price ? `, ${price}` : ""}. Logged on PUBMAXX.`;
}

// ── Crawl story ──────────────────────────────────────────────────────────────

export type CrawlShareInput = {
  title: string;
  stopCount: number;
  // Sum of the priced stops; 0 / null means no priced stop, so no money line.
  totalGbp?: number | null;
};

export function buildCrawlShareText(input: CrawlShareInput): string {
  const { title, stopCount } = input;
  const total = gbp(input.totalGbp);
  return `${title}. ${countNoun(stopCount, "stop")}${
    total ? `, ${total} a round` : ""
  }. Listed on PUBMAXX.`;
}

// ── Venue (map inspector share) ──────────────────────────────────────────────

export type VenueShareInput = {
  name: string;
  // Cheapest known pint at the venue — omitted from the message when unknown.
  cheapestPintGbp?: number | null;
};

export function buildVenueShareText(input: VenueShareInput): string {
  const price = gbp(input.cheapestPintGbp);
  return price
    ? `${input.name}. Pints from ${price}. On the PUBMAXXING map.`
    : `${input.name}, on the PUBMAXXING map.`;
}

// ── Bar tab (venue recap page) ───────────────────────────────────────────────

export type BarTabShareInput = {
  venueName: string;
};

export function buildBarTabShareText(input: BarTabShareInput): string {
  return `Recent pints logged at ${input.venueName} on PUBMAXX.`;
}

// ── Pint Passport (profile recap) ────────────────────────────────────────────

export type PassportShareInput = {
  displayName: string;
  pubs: number;
  boroughs: number;
  pints: number;
  isEmpty: boolean;
};

export function buildPassportShareText(input: PassportShareInput): string {
  if (input.isEmpty) {
    return "Start a Pint Passport on PUBMAXXING. Every pint stamps a page.";
  }
  const { displayName, pubs, boroughs, pints } = input;
  return `${displayName} · ${countNoun(pubs, "pub")} · ${countNoun(
    boroughs,
    "borough",
  )} · ${countNoun(pints, "pint")} on PUBMAXXING`;
}

// ── Saved list ───────────────────────────────────────────────────────────────

export type SavedListShareInput = {
  owner: string;
  listType: string;
  venueCount: number;
};

export function buildSavedListShareText(input: SavedListShareInput): string {
  return `${input.owner}'s ${input.listType} list. ${formatSavedVenueCount(
    input.venueCount,
  )} on PUBMAXXING.`;
}

// ── Historic pub ─────────────────────────────────────────────────────────────

export type HistoricPubShareInput = {
  name: string;
  // The editorial hook line from the historic pack, when one exists.
  hook?: string | null;
};

export function buildHistoricPubShareText(input: HistoricPubShareInput): string {
  const hook = input.hook?.trim();
  return hook || `${input.name}. A historic London pub.`;
}

// ── wa.me deep link ──────────────────────────────────────────────────────────
// The one WhatsApp URL idiom (matches ShareBar and lib/tfl's lastPintShareHref):
// message text first, then the absolute URL when the artifact points somewhere.
// Self-contained messages (Last Pint) simply pass no URL.

export function whatsappShareHref(text: string, url?: string): string {
  const payload = url ? `${text} ${url}` : text;
  return `https://wa.me/?text=${encodeURIComponent(payload)}`;
}
