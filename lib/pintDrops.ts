import { randomUUID } from "crypto";

import type { Provenance } from "@/lib/curation";
import { demoDropsFor, demoPintDrops } from "@/lib/pintDropSeeds";
import { checkRateLimitDurable, isSupabaseConfigured } from "@/lib/supabase";

// A Pint Drop is one object with optional parts: a price log, a passed-down
// memory, or both. Photos are deferred to the Storage-backed adapter (see
// lib/pintDropsStore) — the v1 seam persists the text/price payload only.
export type PintDropInput = {
  venueId: string;
  handle: string;
  drink?: string;
  priceGbp?: number | null;
  passedDownNote?: string;
  era?: string;
  vibeTags?: string[];
};

// Server-authoritative vibe-tag allowlist (PRD §8 "quick tags"). The client
// mirrors this list for UX, but the server is the trust boundary: anything not
// on this exact list is dropped on the way in (see validatePintDrop). Kept as a
// frozen array so the order is stable and it can't be mutated at runtime.
export const VIBE_TAGS = [
  "cheap",
  "chaotic",
  "quiet pint",
  "old local",
  "date night",
  "coding pint",
  "last train",
  "riverside",
  "hidden gem",
  "first legal pint",
] as const;

export type VibeTag = (typeof VIBE_TAGS)[number];

const VIBE_TAG_SET: ReadonlySet<string> = new Set(VIBE_TAGS);
const MAX_VIBE_TAGS = 4;

/**
 * Normalise an untrusted vibe-tag list: accept only allow-listed tags
 * (case-insensitively), dedupe, and cap at MAX_VIBE_TAGS. Never trusts the
 * client — an unknown or malformed tag is silently dropped, not stored.
 */
export function cleanVibeTags(value: unknown): VibeTag[] {
  if (!Array.isArray(value)) return [];
  const out: VibeTag[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase();
    if (VIBE_TAG_SET.has(tag) && !out.includes(tag as VibeTag)) {
      out.push(tag as VibeTag);
      if (out.length >= MAX_VIBE_TAGS) break;
    }
  }
  return out;
}

export type PintDropStatus = "visible" | "hidden" | "pending";

// Per-drop visibility (issue #29, PRD § "The Spill"). Orthogonal to `status`
// (moderation): a drop can be `visible`+`friends` (moderation-clean, follower-
// gated) or `hidden`+`public` (reported). Default is `public` so every existing
// row and any write that omits it keeps today's behaviour.
//
//   • public     — feed, map, leaderboards, ledger, permalink (today's default).
//   • friends    — author + the author's FOLLOWERS only (see qualifiesForFriends).
//   • legacy      — the family/heirloom lane: ledger + author ONLY; kept out of the
//                  feed/map/leaderboard signals (see listLegacyForVenue).
//   • anonymous  — shown publicly, handle WITHHELD in every DTO (ANON_HANDLE_LABEL);
//                  the real handle is stored server-side for moderation/limits and
//                  must never leak through a public read.
export const VISIBILITIES = ["public", "friends", "legacy", "anonymous"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
const VISIBILITY_SET: ReadonlySet<string> = new Set(VISIBILITIES);

/** The default visibility for any drop that doesn't specify one — today's
 *  behaviour, and the DB column default, kept in lockstep here. */
export const DEFAULT_VISIBILITY: Visibility = "public";

/**
 * The withheld-handle label a public surface renders for an `anonymous` drop.
 * The store swaps the real handle for this in EVERY DTO — the real handle never
 * leaves the server for an anonymous drop. Kept as one constant so the feed,
 * permalink, ledger, and any future surface agree on the exact string.
 */
export const ANON_HANDLE_LABEL = "a PUBMAXXER";

/** Coerce an untrusted value to a Visibility, defaulting to `public`. Anything
 *  off the allowlist collapses to the safe default (never throws) — the write
 *  path is additive and forgiving, exactly like cleanVibeTags. */
export function cleanVisibility(value: unknown): Visibility {
  if (typeof value === "string" && VISIBILITY_SET.has(value)) return value as Visibility;
  return DEFAULT_VISIBILITY;
}

export type PintDrop = {
  id: string;
  venueId: string;
  handle: string;
  drink: string;
  priceGbp: number | null;
  passedDownNote: string;
  era: string;
  // Optional so old rows / notes-only drops read fine without them. Always a
  // server-filtered subset of VIBE_TAGS (never client-trusted) — public content.
  vibeTags?: VibeTag[];
  provenance: Provenance;
  status: PintDropStatus;
  // Per-drop visibility (issue #29). Optional on the type so old rows / demo
  // seeds without the field read as the default `public` — normalise reads with
  // visibilityOf() rather than touching this directly.
  visibility?: Visibility;
  createdAt: string;
  // Moderation metadata — set once a drop is reported/reviewed. Optional so old
  // rows and fresh drops read fine without them.
  reportedAt?: string;
  reportReason?: string;
  reportCount?: number;
  moderatedAt?: string;
  moderatorNote?: string;
};

export type ValidationResult =
  | { ok: true; value: PintDrop }
  | { ok: false; error: string };

// Trust boundary. Never lazy here: the client is untrusted. Strip anything that
// could be HTML/script, cap lengths, and clamp the price to a sane pub range.
const MAX_NOTE = 500;
const MAX_HANDLE = 40;
const MAX_DRINK = 60;
const MAX_ERA = 40;
const MAX_PRICE = 20; // a £40 "pint" is a typo or abuse, not a data point.

function clean(value: unknown, cap: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "") // no inline user HTML
    .replace(/[\u0000-\u001f\u007f]/g, " ") // strip control chars
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}

/**
 * Validate + normalise an untrusted submission into a persistable Pint Drop.
 * A drop must carry at least one signal: a price OR a passed-down note.
 * Provenance follows the evidence: a priced drop is `contributor`
 * (photo/price evidence), a note-only drop is an unverifiable `anecdote`.
 */
export function validatePintDrop(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Missing submission body." };
  }
  const raw = input as Record<string, unknown>;

  const venueId = clean(raw.venueId, 64);
  if (!venueId) return { ok: false, error: "A venue is required." };

  const handle = clean(raw.handle, MAX_HANDLE);
  if (!handle) return { ok: false, error: "Add a contributor handle." };

  const note = clean(raw.passedDownNote, MAX_NOTE);

  let priceGbp: number | null = null;
  if (raw.priceGbp !== undefined && raw.priceGbp !== null && raw.priceGbp !== "") {
    const parsed = Number(raw.priceGbp);
    if (!Number.isFinite(parsed)) return { ok: false, error: "Price must be a number." };
    if (parsed <= 0 || parsed > MAX_PRICE) {
      return { ok: false, error: `Price must be between £0 and £${MAX_PRICE}.` };
    }
    priceGbp = Math.round(parsed * 100) / 100;
  }

  if (priceGbp === null && !note) {
    return { ok: false, error: "Add a price or a passed-down note." };
  }

  const provenance: Provenance = priceGbp !== null ? "contributor" : "anecdote";

  // Vibe tags are supporting metadata, not a standalone signal: they never
  // satisfy the price-or-note requirement above. Filtered to the allowlist here.
  const vibeTags = cleanVibeTags(raw.vibeTags);

  // Visibility is additive + forgiving: any off-allowlist value (or an omitted
  // field) collapses to the default `public`, so an old client that never sends
  // it behaves exactly as before. Always stamped explicitly so a persisted drop
  // carries its lane.
  const visibility = cleanVisibility(raw.visibility);

  return {
    ok: true,
    value: {
      id: randomUUID(),
      venueId,
      handle,
      drink: clean(raw.drink, MAX_DRINK),
      priceGbp,
      passedDownNote: note,
      era: clean(raw.era, MAX_ERA),
      ...(vibeTags.length ? { vibeTags } : {}),
      provenance,
      status: "visible",
      visibility,
      createdAt: new Date().toISOString(),
    },
  };
}

// ── In-memory store ──────────────────────────────────────────────────────────
// Process-memory store, resets on restart — right for the prototype demo. Swap
// for the Supabase adapter (lib/pintDropsStore) when keys exist; the
// validation/provenance/moderation logic above is storage-agnostic and unchanged.
const drops = new Map<string, PintDrop[]>();

// Naive per-handle rate limit (in-memory), enough to stop one actor flooding a
// demo. Move to Redis/Supabase counters if this ever ships.
const rateWindow = new Map<string, number[]>();
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60_000;

export function isRateLimited(
  handle: string,
  now = Date.now(),
  limit = RATE_LIMIT,
  windowMs = RATE_WINDOW_MS,
): boolean {
  const key = handle.toLowerCase();
  const hits = (rateWindow.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  rateWindow.set(key, hits);
  return hits.length > limit;
}

/**
 * Combined limiter used by every rate-limited route: durable (Supabase RPC)
 * when configured, in-memory otherwise. A null durable verdict (client missing
 * / RPC error) falls back to the in-memory backstop — fail-open by design, so
 * a limiter outage can never 503 writes (checkRateLimitDurable logs the
 * downgrade loudly).
 */
export async function isLimited(
  localKey: string,
  durableKey: string,
  limit = RATE_LIMIT,
  windowMs = RATE_WINDOW_MS,
): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const verdict = await checkRateLimitDurable(durableKey, limit, windowMs);
    if (typeof verdict === "boolean") return verdict;
  }
  return isRateLimited(localKey, Date.now(), limit, windowMs);
}

export function addPintDrop(drop: PintDrop): void {
  drops.set(drop.venueId, [drop, ...(drops.get(drop.venueId) ?? [])]);
}

/** Public read: newest-first, visible-only. Demo seeds merge in here — the one
 *  read path — so seeded liveliness rides the same pipe as organic drops. */
export function listVisiblePintDrops(venueId: string): PintDrop[] {
  return [
    ...(drops.get(venueId) ?? []).filter((d) => d.status === "visible"),
    ...demoDropsFor(venueId),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listAllVisiblePintDrops(): PintDrop[] {
  return Array.from(drops.values())
    .flat()
    .filter((d) => d.status === "visible")
    .concat(demoPintDrops)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── Visibility gating (issue #29) ────────────────────────────────────────────
// Pure predicates over the (drop, viewer) pair. The STORE applies these after a
// moderation-status filter, so a hidden drop never reaches them. Kept pure +
// exported so they can be unit-tested directly and reused by every read seam.

/** The effective visibility of a drop (old rows / demo seeds → `public`). */
export function visibilityOf(drop: Pick<PintDrop, "visibility">): Visibility {
  return drop.visibility ?? DEFAULT_VISIBILITY;
}

/**
 * The requester's identity for a friends-gated read. Self-asserted (no auth yet
 * — same courtesy-curtain trust boundary as lib/notifications.ts). `handle` is
 * the viewer's own handle; `followingHandles` is the set of NORMALISED handles
 * the viewer follows (its followees). A follower of an author is a viewer whose
 * `followingHandles` CONTAINS the author — i.e. the friends lane shows a drop to
 * the author's followers (see qualifiesForFriends).
 *
 * Both fields optional: an anonymous viewer (no handle / no follow set) sees only
 * public + anonymous drops.
 */
export type ViewerContext = {
  /** The viewer's own self-asserted handle (raw or normalised — normalised on use). */
  handle?: string | null;
  /** Normalised handles the viewer follows (its followees). */
  followingHandles?: ReadonlySet<string>;
};

/**
 * Normalise a handle for viewer-identity + author matching, without importing the
 * profiles module here (lib/pintDrops.ts is the storage-agnostic core and stays
 * dependency-light). Mirrors normalizeHandle: lowercase, strip leading @s, keep
 * [a-z0-9_], cap length. Kept in step with lib/profiles.normalizeHandle. Exported
 * as `normalizeViewerHandle` for the route that builds a ViewerContext.
 */
export function normalizeViewerHandle(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9_]/g, "").slice(0, MAX_HANDLE);
}

/** Is the viewer the author of this drop? (Self always sees own drops, in every
 *  lane.) Compares normalised handles — a self-asserted, honest-best-effort
 *  match, not a cryptographic one. */
export function isAuthor(drop: Pick<PintDrop, "handle">, viewer?: ViewerContext): boolean {
  const me = normalizeViewerHandle(viewer?.handle);
  return me !== "" && me === normalizeViewerHandle(drop.handle);
}

/**
 * Friends direction (JUSTIFICATION): a `friends` drop is visible to the author
 * and to the AUTHOR'S FOLLOWERS. A viewer qualifies as a follower of the author
 * when the author's handle is in the viewer's `followingHandles` (the viewer
 * follows the author). This is the simplest honest reading of the directed
 * follow graph in migration 0006 (follows.follower_id → followee_id): "people
 * who follow me see my friends-only drops". It is NOT mutual-only (that would
 * hide a drop from a brand-new follower the author hasn't followed back) and NOT
 * "people the author follows" (that would show it to strangers the author
 * follows). Followers-of-the-author matches the social intent of "my crew sees
 * this" and reuses the exact follow-set the Friends feed lane already computes
 * (lib/feed.ts followingHandles), so gating and the lane stay consistent.
 */
export function qualifiesForFriends(
  drop: Pick<PintDrop, "handle">,
  viewer?: ViewerContext,
): boolean {
  const author = normalizeViewerHandle(drop.handle);
  if (!author) return false;
  return Boolean(viewer?.followingHandles?.has(author));
}

/**
 * Can this viewer see this drop on a PUBLIC surface (feed, map, leaderboard,
 * venue list, permalink)? Applied AFTER the moderation-status filter.
 *
 *   • public     → everyone.
 *   • anonymous  → everyone (the handle is withheld at DTO time, not here).
 *   • friends    → author + the author's followers (qualifiesForFriends).
 *   • legacy     → author ONLY on public surfaces; otherwise the ledger-only
 *                  capability (listLegacyForVenue) surfaces it. Kept out of every
 *                  public signal here.
 */
export function canViewOnPublicSurface(drop: PintDrop, viewer?: ViewerContext): boolean {
  switch (visibilityOf(drop)) {
    case "public":
    case "anonymous":
      return true;
    case "friends":
      return isAuthor(drop, viewer) || qualifiesForFriends(drop, viewer);
    case "legacy":
      return isAuthor(drop, viewer);
    default:
      return true;
  }
}

/** The in-memory legacy lane for one venue: legacy drops only, visible-only,
 *  newest-first (the ledger-only capability's memory backing). Author-gating on
 *  the ledger is a surface decision; this returns the venue's legacy drops so the
 *  ledger read can adopt it. Demo seeds are all `public`, so none leak in. */
export function listLegacyPintDropsForVenue(venueId: string): PintDrop[] {
  return (drops.get(venueId) ?? [])
    .filter((d) => d.status === "visible" && visibilityOf(d) === "legacy")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function findDrop(id: string): PintDrop | undefined {
  for (const list of drops.values()) {
    const hit = list.find((d) => d.id === id);
    if (hit) return hit;
  }
  return undefined;
}

// Report-abuse policy (launch PRD): one unauthenticated report must not hide
// content. Every report records metadata (and is rate-limited per drop at the
// route); the drop leaves public reads only once this many reports accumulate.
export const REPORT_HIDE_THRESHOLD = 2;

export function reportPintDrop(id: string, reason?: string): boolean {
  const hit = findDrop(id);
  if (!hit) return false;
  hit.reportedAt = new Date().toISOString();
  hit.reportCount = (hit.reportCount ?? 0) + 1;
  if (reason) hit.reportReason = reason;
  if (hit.reportCount >= REPORT_HIDE_THRESHOLD) hit.status = "hidden";
  return true;
}

/** Moderator read: every drop in a status, across venues, newest-first. */
export function listByStatus(status: PintDropStatus): PintDrop[] {
  return Array.from(drops.values())
    .flat()
    .filter((d) => d.status === status && !d.moderatedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Moderator action: return a drop to visible and stamp the review time. */
export function restorePintDrop(id: string, note?: string): boolean {
  const hit = findDrop(id);
  if (!hit) return false;
  hit.status = "visible";
  hit.moderatedAt = new Date().toISOString();
  if (note) hit.moderatorNote = note;
  return true;
}

/** Moderator action: leave hidden, record the review so it drops off the queue. */
export function keepHiddenPintDrop(id: string, note?: string): boolean {
  const hit = findDrop(id);
  if (!hit) return false;
  hit.status = "hidden";
  hit.moderatedAt = new Date().toISOString();
  if (note) hit.moderatorNote = note;
  return true;
}

// Test-only: reset process state between cases.
export function __resetPintDrops(): void {
  drops.clear();
  rateWindow.clear();
}
