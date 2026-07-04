import { randomUUID } from "crypto";

import type { Provenance } from "@/lib/curation";
import { demoDropsFor, demoPintDrops } from "@/lib/pintDropSeeds";

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
};

export type PintDropStatus = "visible" | "hidden" | "pending";

export type PintDrop = {
  id: string;
  venueId: string;
  handle: string;
  drink: string;
  priceGbp: number | null;
  passedDownNote: string;
  era: string;
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

export function isRateLimited(handle: string, now = Date.now()): boolean {
  const key = handle.toLowerCase();
  const hits = (rateWindow.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateWindow.set(key, hits);
  return hits.length > RATE_LIMIT;
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
  ];
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

export function reportPintDrop(id: string, reason?: string): boolean {
  const hit = findDrop(id);
  if (!hit) return false;
  hit.status = "hidden"; // hidden immediately, pending review
  hit.reportedAt = new Date().toISOString();
  hit.reportCount = (hit.reportCount ?? 0) + 1;
  if (reason) hit.reportReason = reason;
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
