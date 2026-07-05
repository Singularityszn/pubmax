// InstaPint feed model — a pure, testable normalizer + cursor pagination over
// the public Pint Drops API. The /feed page fetches `/api/pint-drops`, maps each
// DTO through normalizePintDrop, then filters/paginates with the helpers here.
// No React, no fetch, no side effects — every export is a pure function so the
// whole feed is covered by __tests__/feed.test.ts.

import type { Provenance } from "@/lib/curation";

// The public read shape as it arrives over the wire from GET /api/pint-drops
// ({ drops: [...] }). Kept structural (not imported from the store's DTO type)
// so this module has no server coupling — the fields are exactly the public
// InstaPint payload documented on the route.
export type PintDropDTO = {
  id: string;
  handle: string;
  priceGbp: number | null;
  drink: string;
  passedDownNote: string;
  era: string;
  provenance: Provenance;
  venueId: string;
  createdAt: string;
  vibeTags?: string[];
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  // Server-resolved pub name + "open on the map" link (PRD §9). The GET route
  // enriches every drop from the venue index so a card never has to surface the
  // raw content-hashed `venue-…` id. Optional so an unenriched/legacy payload
  // (or a demo seed for an id the dataset no longer carries) still normalises.
  venueName?: string;
  venueMapUrl?: string;
};

// A normalized feed item. `type` is a lane discriminant so the surface can grow
// beyond raw pint drops (crawl stories, cheap-pint highlights) without the card
// needing to know which lane produced it. Every lane resolves to this one shape.
export type FeedItemType = "pint_drop" | "crawl_story" | "cheap_pint";

export type FeedItem = {
  type: FeedItemType;
  id: string;
  createdAt: string;
  handle: string;
  venueId: string;
  // The human pub name, server-resolved from venueId (PRD §9). A friendly
  // fallback ("A London pub") when the id is unresolved — the card NEVER renders
  // the raw `venue-…` id.
  venueName: string;
  // "/map?sel=…" — tapping the venue opens the map with this pub selected.
  venueMapUrl: string;
  // Non-null photo URLs only, pint photo first (the hero of an InstaPint card),
  // then the venue selfie. Empty when a drop is text-only → card renders a
  // typographic "receipt" instead.
  photoUrls: string[];
  caption: string;
  priceGbp: number | null;
  vibeTags: string[];
  provenance: Provenance;
  drink: string;
  era: string;
};

// The friendly label shown when an id has no resolvable pub name — kept here so
// the server route, the normalizer, and any test agree on one string.
export const VENUE_FALLBACK_LABEL = "A London pub";

// Build the canonical "open this pub on the map" link. Mirrors venueMapUrl in
// lib/venueIndex.ts, but this module is client-safe (no `fs`), so the normalizer
// can derive a link even for a payload that predates server enrichment.
function mapUrlFor(venueId: string): string {
  return `/map?sel=${encodeURIComponent(venueId)}`;
}

/**
 * Normalise one public Pint Drop DTO into a FeedItem. Collects the non-null
 * photo URLs (pint first, then venue) into `photoUrls`, coerces the optional
 * vibeTags to an array, and folds the drink + passed-down note into a caption.
 * Pure — never trusts field presence beyond the documented DTO shape.
 */
export function normalizePintDrop(dto: PintDropDTO): FeedItem {
  const photoUrls = [dto.pintPhotoUrl, dto.venuePhotoUrl].filter(
    (url): url is string => typeof url === "string" && url.length > 0,
  );
  // Prefer the server-resolved name; fall back to the friendly label so the raw
  // venue id is never surfaced. The link prefers the server's venueMapUrl but is
  // reconstructable from the id for older payloads.
  const venueName =
    typeof dto.venueName === "string" && dto.venueName.trim().length > 0
      ? dto.venueName
      : VENUE_FALLBACK_LABEL;
  const venueMapUrl =
    typeof dto.venueMapUrl === "string" && dto.venueMapUrl.length > 0
      ? dto.venueMapUrl
      : mapUrlFor(dto.venueId);
  return {
    type: "pint_drop",
    id: dto.id,
    createdAt: dto.createdAt,
    handle: dto.handle,
    venueId: dto.venueId,
    venueName,
    venueMapUrl,
    photoUrls,
    caption: dto.passedDownNote ?? "",
    priceGbp: dto.priceGbp ?? null,
    vibeTags: Array.isArray(dto.vibeTags) ? dto.vibeTags : [],
    provenance: dto.provenance,
    drink: dto.drink ?? "",
    era: dto.era ?? "",
  };
}

// ── Filters ──────────────────────────────────────────────────────────────────

export type FeedFilter =
  | "tonight"
  | "friends"
  | "nearby"
  | "cheap"
  | "crawls"
  | "golden-days";

export type FeedFilterDef = {
  id: FeedFilter;
  label: string;
  // Whether the filter is backed by real data signals or is a best-effort demo
  // lane. Surfaced honestly so the UI never implies a capability it lacks.
  demo: boolean;
};

// Order matters — this is the on-screen chip order.
export const FEED_FILTERS: FeedFilterDef[] = [
  { id: "tonight", label: "Tonight", demo: false },
  { id: "friends", label: "Friends", demo: true },
  { id: "nearby", label: "Near Me", demo: true },
  { id: "cheap", label: "Cheap Legends", demo: false },
  { id: "crawls", label: "Crawls", demo: true },
  { id: "golden-days", label: "Golden Days", demo: false },
];

const CHEAP_MAX_GBP = 5.5;
const TONIGHT_WINDOW_MS = 24 * 60 * 60 * 1000;

function createdMs(item: FeedItem): number {
  const t = Date.parse(item.createdAt);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Apply a feed filter as a pure transform over already-normalised items.
 *
 * Real filters (backed by data on every drop):
 *  - `tonight`     — drops created in the last 24h (by createdAt).
 *  - `cheap`       — priced <= £5.50, sorted by price ascending (cheapest first).
 *  - `golden-days` — anecdote/heritage drops carrying an `era` (passed-down
 *                    memories), newest-first — the nostalgia lane.
 *
 * Demo-only filters (no per-drop signal in the public payload; best-effort so
 * the lane isn't empty in the prototype — documented as demo in FEED_FILTERS):
 *  - `friends`     — no social graph exists; returns the full set unchanged.
 *  - `nearby`      — no geolocation on the client feed; returns the full set.
 *  - `crawls`      — no per-drop crawl linkage yet; returns the full set.
 */
export function applyFeedFilter(items: FeedItem[], filter: FeedFilter): FeedItem[] {
  switch (filter) {
    case "cheap":
      return items
        .filter((i) => typeof i.priceGbp === "number" && i.priceGbp <= CHEAP_MAX_GBP)
        .sort((a, b) => (a.priceGbp as number) - (b.priceGbp as number));
    case "tonight": {
      const now = Date.now();
      return items.filter((i) => now - createdMs(i) <= TONIGHT_WINDOW_MS);
    }
    case "golden-days":
      return items
        .filter((i) => i.era.trim().length > 0 || i.provenance === "anecdote")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "friends":
    case "nearby":
    case "crawls":
    default:
      // Demo lanes: no per-drop signal — pass the set through untouched.
      return items;
  }
}

// ── Cursor pagination ─────────────────────────────────────────────────────────

// A cursor is the "createdAt|id" of the last item on a page — NOT an offset, so
// it is stable as newer items are prepended (an offset would skip/duplicate).
export type FeedPage = { items: FeedItem[]; nextCursor: string | null };

export function cursorOf(item: FeedItem): string {
  return `${item.createdAt}|${item.id}`;
}

/**
 * Cursor-paginate `items`. With no cursor, returns the first `limit`. With a
 * cursor, returns the `limit` items that follow the item whose cursor matches
 * (the cursor item itself is excluded). `nextCursor` is the cursor of the last
 * returned item, or null when the page reaches the end of the list. Pure.
 */
export function paginate(
  items: FeedItem[],
  cursor?: string | null,
  limit = 12,
): FeedPage {
  let start = 0;
  if (cursor) {
    const idx = items.findIndex((i) => cursorOf(i) === cursor);
    // Unknown cursor → start from the top rather than throwing; a stale cursor
    // should degrade to "first page", never crash the feed.
    start = idx === -1 ? 0 : idx + 1;
  }
  const page = items.slice(start, start + limit);
  const last = page[page.length - 1];
  const reachedEnd = start + page.length >= items.length;
  const nextCursor = last && !reachedEnd ? cursorOf(last) : null;
  return { items: page, nextCursor };
}
