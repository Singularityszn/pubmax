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
// Current shareable night objects (audit, 2026-07-17):
//   plan invite  app/plan/[id]        → ShareBar (shareCopyForPlan)
//   pint drop    app/p/[id] + FeedCard → ShareBar (inline copy, duplicated)
//   crawl story  app/crawls/[slug]    → ShareBar (inline copy)
//   bar tab      app/bar-tab/[id]     → ShareBar (inline copy)
//   venue        map VenueInspector   → useVenueShare ("PUBMAXXING — name")
//   passport     PintPassport         → ShareBar (inline copy)
//   saved list   SavedListDetail      → ShareBar (inline copy)
//   historic pub app/historic/[slug]  → ShareBar (hook or fallback)

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
  return `${parts.join(" · ")} — open the link and tap I'm in.`;
}

// ── Pint drop (permalink card + feed card share the same message) ────────────

export type PintDropShareInput = {
  venueName: string;
  priceGbp?: number | null;
  // Display handle ("@old_ken" already resolved by the call site). Omitted on
  // the drinker's own permalink where "Found a proper pint…" reads first-person.
  handle?: string | null;
};

export function buildPintDropShareText(input: PintDropShareInput): string {
  const { venueName, handle } = input;
  const price = gbp(input.priceGbp);
  const opener = handle
    ? `${handle} found a proper pint at ${venueName}`
    : `Found a proper pint at ${venueName}`;
  return `${opener}${price ? ` — ${price}` : ""}. Every pint has a story.`;
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
  return `${title} — ${countNoun(stopCount, "stop")}${
    total ? `, ${total} a round` : ""
  }. Every pint has a story.`;
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
    ? `${input.name} — pints from ${price}. On the PUBMAXXING map.`
    : `${input.name}, on the PUBMAXXING map.`;
}

// ── Bar tab (venue recap page) ───────────────────────────────────────────────

export type BarTabShareInput = {
  venueName: string;
};

export function buildBarTabShareText(input: BarTabShareInput): string {
  return `Recent pints at ${input.venueName}. Every pint has a story.`;
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
    return "Start a Pint Passport on PUBMAXXING — every pint stamps a page.";
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
  pubCount: number;
};

export function buildSavedListShareText(input: SavedListShareInput): string {
  return `${input.owner}'s ${input.listType} list — ${countNoun(
    input.pubCount,
    "pub",
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
  return hook || `${input.name} — a historic London pub.`;
}

// ── wa.me deep link ──────────────────────────────────────────────────────────
// The one WhatsApp URL idiom (matches ShareBar and lib/tfl's lastPintShareHref):
// message text first, then the absolute URL when the artifact points somewhere.
// Self-contained messages (Last Pint) simply pass no URL.

export function whatsappShareHref(text: string, url?: string): string {
  const payload = url ? `${text} ${url}` : text;
  return `https://wa.me/?text=${encodeURIComponent(payload)}`;
}
