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
      createdAt: new Date().toISOString(),
    },
  };
}

// ── In-memory store ──────────────────────────────────────────────────────────
// ponytail: process-memory store, resets on restart — right for the prototype
// demo. Swap for the Supabase adapter (lib/pintDropsStore) when keys exist; the
// validation/provenance/moderation logic above is storage-agnostic and unchanged.
const drops = new Map<string, PintDrop[]>();

// ponytail: naive per-handle rate limit (in-memory), enough to stop one actor
// flooding a demo. Move to Redis/Supabase counters if this ever ships.
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
