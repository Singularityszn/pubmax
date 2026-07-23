// Structured Visit Reports v1 (Wayfinder 3.4) — the BROWSER-SAFE domain core.
//
// A Visit Report is the honest, structured sibling of the free-text Pint Drop
// anecdote: someone was at a pub on a given evening and taps a few fixed
// choices (how busy, the vibe, would they go back, did the price feel fair) plus
// an optional short note. It is deliberately narrow — no free-text tags, no star
// score, no averages dressed up as a score. The recency-weighted SUMMARY
// (lib/visitReportSummary.ts) turns a pile of these into plain lines like
// "Usually steady, most would return", never a number pretending to be a rating.
//
// This module is PURE + browser-safe (no @/lib/supabase, no node builtins, no
// React) so the capture card AND the server route share the EXACT same
// vocabulary + validation and can never drift — the same split pintDrops uses
// (pintDropShared.ts) and areaDemand.ts follows. The durable/in-memory stores
// and moderation live in lib/visitReportsStore.ts (the impure seam); id +
// timestamps are stamped THERE, so nothing here needs crypto.
//
// Duty of care (kept in step with lib/ratings.ts + VenueRatingPanel): every
// field rates the PUB and the night, never the drinker. No streaks, no points,
// no public star score.

import { londonDayKey } from "@/lib/pintContributions";
import { presentableDescription } from "@/lib/slopFilter";

// ── Fixed vocabularies ───────────────────────────────────────────────────────
// Small, closed sets. The client can only ever send one of these; anything else
// is normalised to null (never stored raw), and the DB CHECK constraints in
// migration 0046 mirror them (defence in depth).

/** How busy the pub was. */
export const BUSYNESS_VALUES = ["quiet", "steady", "rammed"] as const;
export type Busyness = (typeof BUSYNESS_VALUES)[number];

/** The vibe, a SINGLE pick from a fixed vocabulary — never free-text tags (that
 *  is what invites slop). Kept short and plain, on the safe register. */
export const ATMOSPHERE_VALUES = [
  "cosy",
  "lively",
  "chilled",
  "rowdy",
  "traditional",
  "sporty",
] as const;
export type Atmosphere = (typeof ATMOSPHERE_VALUES)[number];

/** Would the reporter come back. */
export const WOULD_RETURN_VALUES = ["yes", "no"] as const;
export type WouldReturn = (typeof WOULD_RETURN_VALUES)[number];

/** Did the price feel fair on the night — a sanity read, NOT a figure. The
 *  numeric price moat stays the Pint Drop's job; this is only "fine" vs "steep". */
export const PRICE_SANITY_VALUES = ["fine", "steep"] as const;
export type PriceSanity = (typeof PRICE_SANITY_VALUES)[number];

/** A note is a courtesy line, not an essay. 140 chars keeps it a caption. */
export const MAX_VISIT_NOTE = 140;

const MAX_VENUE_ID = 64;
const MAX_HANDLE = 40;

/**
 * The one interruptive-prompt id the capture card claims from the shared
 * per-session budget (lib/promptBudget.ts), so a visit-report prompt never
 * stacks on top of the A2HS / first-run / identity-nudge surfaces in one
 * sitting. Value-first: the SUMMARY always renders; only the ASK respects this.
 */
export const VISIT_REPORT_PROMPT_SURFACE = "visit-report";

export type VisitReportStatus = "visible" | "hidden";

/** The validated, normalised fields the store persists (id + timestamps + the
 *  moderation ledger are stamped by the store, keeping this module crypto-free
 *  and browser-safe). */
export type VisitReportFields = {
  venueId: string;
  handle: string;
  /** The evening the visit happened, as a London calendar day (YYYY-MM-DD). One
   *  report per handle per venue per night keys on exactly this. */
  visitedAt: string;
  busyness: Busyness | null;
  atmosphere: Atmosphere | null;
  wouldReturn: WouldReturn | null;
  priceSanity: PriceSanity | null;
  /** "" when none — always a string, never null, so it round-trips cleanly. */
  note: string;
};

/** A persisted Visit Report: the validated fields plus store-stamped identity,
 *  status, and the moderation metadata (mirrors the Pint Drop report ledger). */
export type VisitReport = VisitReportFields & {
  id: string;
  status: VisitReportStatus;
  createdAt: string;
  reportedAt?: string;
  reportReason?: string;
  reportCount?: number;
  /** Distinct actor hashes that have reported this row — de-dupes so one actor
   *  can never bump the hide counter twice (the array-column mirror of the Pint
   *  Drop per-actor report ledger). */
  reportActors?: string[];
  moderatedAt?: string;
  moderatorNote?: string;
};

/** The public read shape: the row minus the moderation trail (reporter metadata
 *  and moderator notes never leave the server), mirroring PintDropDTO. */
export type VisitReportDTO = Omit<
  VisitReport,
  "reportedAt" | "reportReason" | "reportCount" | "reportActors" | "moderatedAt" | "moderatorNote" | "status"
>;

export type ValidationResult =
  | { ok: true; value: VisitReportFields }
  | { ok: false; error: string };

// ── Normalisers ──────────────────────────────────────────────────────────────

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
 * Normalise a handle for identity + author matching, without importing the
 * profiles module (this stays browser-safe + dependency-light). Mirrors
 * lib/profiles.normalizeHandle and lib/pintDrops.normalizeViewerHandle:
 * lowercase, strip leading @s, keep [a-z0-9_], cap length.
 */
export function normalizeHandle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9_]/g, "").slice(0, MAX_HANDLE);
}

function coerce<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

export function cleanBusyness(value: unknown): Busyness | null {
  return coerce(value, BUSYNESS_VALUES);
}
export function cleanAtmosphere(value: unknown): Atmosphere | null {
  return coerce(value, ATMOSPHERE_VALUES);
}
export function cleanWouldReturn(value: unknown): WouldReturn | null {
  return coerce(value, WOULD_RETURN_VALUES);
}
export function cleanPriceSanity(value: unknown): PriceSanity | null {
  return coerce(value, PRICE_SANITY_VALUES);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// A visit before ~5am London still belongs to the night that started the
// previous calendar day — the "evening date". Shift the instant back 5 hours
// BEFORE resolving the London day so 02:00 Saturday maps to Friday's night,
// while 20:00 stays put. DST-robust because the shifted instant is formatted in
// Europe/London, not arithmetic on a bare date.
const EVENING_SHIFT_MS = 5 * 60 * 60 * 1000;

/** The London "evening date" (YYYY-MM-DD) an instant belongs to — pre-dawn
 *  hours fold back onto the night that started the evening before. Pure. */
export function londonEveningKey(instant: Date | number = new Date()): string {
  const ms = typeof instant === "number" ? instant : instant.getTime();
  if (!Number.isFinite(ms)) return "";
  return londonDayKey(new Date(ms - EVENING_SHIFT_MS));
}

/**
 * Resolve an untrusted `visitedAt` to a London evening day key, or null when it
 * is unusable. A bare YYYY-MM-DD is taken as the evening date verbatim (the
 * capture card sends this); a full timestamp is folded through londonEveningKey.
 * A future evening is rejected (you can't report a night that hasn't happened).
 * Omitted → tonight's evening.
 */
export function resolveVisitedAt(value: unknown, now: Date = new Date()): string | null {
  const todayEvening = londonEveningKey(now);
  if (value === undefined || value === null || value === "") return todayEvening;
  let key: string;
  if (typeof value === "string" && DATE_ONLY.test(value.trim())) {
    const trimmed = value.trim();
    // Confirm it is a real calendar date (rejects 2026-13-40).
    const parsed = Date.parse(`${trimmed}T00:00:00Z`);
    if (!Number.isFinite(parsed)) return null;
    key = trimmed;
  } else {
    const ms = typeof value === "number" ? value : Date.parse(String(value));
    if (!Number.isFinite(ms)) return null;
    key = londonEveningKey(ms);
  }
  if (!key) return null;
  // No future nights.
  if (key > todayEvening) return null;
  return key;
}

/** True when the fields carry at least one real signal — a report of nothing is
 *  meaningless and never stored (the "all optional except one" rule: at least
 *  one structured field or a note must be present). */
export function hasSignal(
  fields: Pick<VisitReportFields, "busyness" | "atmosphere" | "wouldReturn" | "priceSanity" | "note">,
): boolean {
  return Boolean(
    fields.busyness ||
      fields.atmosphere ||
      fields.wouldReturn ||
      fields.priceSanity ||
      (fields.note && fields.note.length > 0),
  );
}

/**
 * Validate + normalise an untrusted submission into persistable fields. The
 * trust boundary: venue + handle are required, every structured field is coerced
 * to its allowlist (unknown → null), the note is cleaned, capped, AND run
 * through the slop filter at write time (marketing-register slop is dropped to
 * ""), and at least one signal must survive.
 */
export function validateVisitReport(input: unknown, now: Date = new Date()): ValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Missing submission body." };
  }
  const raw = input as Record<string, unknown>;

  const venueId = clean(raw.venueId, MAX_VENUE_ID);
  if (!venueId) return { ok: false, error: "A venue is required." };

  const handle = normalizeHandle(raw.handle);
  if (!handle) return { ok: false, error: "Add a contributor handle." };

  const visitedAt = resolveVisitedAt(raw.visitedAt, now);
  if (!visitedAt) return { ok: false, error: "That visit date isn't valid." };

  // Slop-filter the note at write time (lib/slopFilter): a note that reads as
  // marketing slop renders/stores nothing, exactly like the venue-story seam.
  const rawNote = clean(raw.note, MAX_VISIT_NOTE);
  const note = presentableDescription(rawNote) ?? "";

  const fields: VisitReportFields = {
    venueId,
    handle,
    visitedAt,
    busyness: cleanBusyness(raw.busyness),
    atmosphere: cleanAtmosphere(raw.atmosphere),
    wouldReturn: cleanWouldReturn(raw.wouldReturn),
    priceSanity: cleanPriceSanity(raw.priceSanity),
    note,
  };

  if (!hasSignal(fields)) {
    return { ok: false, error: "Add at least one detail about your visit." };
  }

  return { ok: true, value: fields };
}

/** Strip the moderation trail for a public read (mirrors PintDrop toDTO). */
export function toVisitReportDTO(report: VisitReport): VisitReportDTO {
  return {
    id: report.id,
    venueId: report.venueId,
    handle: report.handle,
    visitedAt: report.visitedAt,
    busyness: report.busyness,
    atmosphere: report.atmosphere,
    wouldReturn: report.wouldReturn,
    priceSanity: report.priceSanity,
    note: report.note,
    createdAt: report.createdAt,
  };
}

// Report-abuse policy (mirrors lib/pintDrops REPORT_HIDE_THRESHOLD): one report
// must not hide content; a report leaves public reads only once this many
// DISTINCT actors have flagged it.
export const VISIT_REPORT_HIDE_THRESHOLD = 2;
