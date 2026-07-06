// The Round model — the shared vocabulary, the untrusted-input validators, and
// the short join-code generator. Types + pure helpers live here (no store import)
// so a route can validate inputs without pulling the storage backend into scope.
//
// A Round is a group crawl session friends join by a short code — no accounts, the
// same self-asserted `handle` identity as the rest of the social layer (GH #26,
// docs/PRD_FOR_FABLE.md § The Spill). As members log Pint Drops through the night,
// the Round's route builds itself: each member's drop at a NEW pub appends a stop.
// See supabase/migrations/0011_rounds.sql for the honest trust-boundary note (the
// code IS the capability).

import { normalizeHandle } from "@/lib/profiles";
import { cleanText, readString } from "@/lib/textClean";

// ── Join code ────────────────────────────────────────────────────────────────
// Short, human-shareable, spoken aloud ("tell your mates: JXKQ7M"). The alphabet
// deliberately drops the ambiguous glyphs (O/0, I/1, L, and — importantly — every
// vowel) so a code can never accidentally spell a word and can't be misheard as
// O-vs-0 or I-vs-1. 6 chars over a 26-symbol alphabet is ~309M combinations —
// plenty of headroom for a demo, and short enough to type.
export const ROUND_CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXYZ23456789"; // no vowels, no O/0/I/1/L
export const ROUND_CODE_LENGTH = 6;

const CODE_CHARSET: ReadonlySet<string> = new Set(ROUND_CODE_ALPHABET.split(""));

/**
 * Generate one random join code. Uses crypto-grade randomness when available
 * (browser / Node globalThis.crypto) and falls back to Math.random only if the
 * platform has no crypto — a code is a low-stakes join key, never a secret, so
 * the fallback is acceptable and the caller (the store) retries on the rare
 * collision anyway via the DB's unique constraint.
 */
export function generateRoundCode(length = ROUND_CODE_LENGTH): string {
  const n = ROUND_CODE_ALPHABET.length;
  const out: string[] = [];
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < length; i += 1) out.push(ROUND_CODE_ALPHABET[bytes[i] % n]);
  } else {
    for (let i = 0; i < length; i += 1) {
      out.push(ROUND_CODE_ALPHABET[Math.floor(Math.random() * n)]);
    }
  }
  return out.join("");
}

/**
 * Normalise an untrusted code to the canonical form (uppercase, alphabet-only).
 * Total + never throws: junk in yields a (possibly empty) safe code out. Used on
 * BOTH sides — codes are stored and looked up in this canonical form, so a mate
 * typing "jxkq7m " or "jxkq-7m" still resolves.
 */
export function normalizeRoundCode(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .toUpperCase()
    .split("")
    .filter((ch) => CODE_CHARSET.has(ch))
    .join("")
    .slice(0, ROUND_CODE_LENGTH);
}

/** A code is valid iff it is exactly ROUND_CODE_LENGTH canonical chars. */
export function isValidRoundCode(raw: string | null | undefined): boolean {
  return normalizeRoundCode(raw).length === ROUND_CODE_LENGTH;
}

// ── Field caps ───────────────────────────────────────────────────────────────
export const ROUND_TITLE_MAX = 80;
export const VENUE_NAME_MAX = 120;
export const VENUE_ID_MAX = 80;
export const DROP_REF_MAX = 200;

// ── DTOs ─────────────────────────────────────────────────────────────────────
export type RoundStopDTO = {
  id: string;
  venueId: string;
  venueName: string;
  addedByHandle: string;
  /** The Pint Drop this stop was logged from, when it "built itself" from a drop. */
  dropRef?: string;
  createdAt: string;
};

export type RoundMemberDTO = {
  handle: string;
  joinedAt: string;
};

export type RoundDTO = {
  id: string;
  code: string;
  title: string;
  createdByHandle: string;
  createdAt: string;
  /** ISO string when the Round was closed, or null while it's still out. */
  closedAt: string | null;
};

/** The full live state the Round page renders (one GET). */
export type RoundState = {
  round: RoundDTO;
  members: RoundMemberDTO[];
  stops: RoundStopDTO[];
};

// ── Write payloads (validated) ───────────────────────────────────────────────
export type NewRound = {
  title: string;
  createdByHandle: string;
};

export type NewStop = {
  venueId: string;
  venueName: string;
  addedByHandle: string;
  dropRef?: string;
};

/**
 * Validate an untrusted create-Round payload. Returns null when it can't be
 * created: a missing/blank creator handle (the identity primitive) is the only
 * hard requirement — a blank title falls back to a friendly default so a Round is
 * never nameless. Title is cleaned free text (angle brackets / control chars
 * stripped, capped).
 */
export function cleanNewRound(input: {
  title?: unknown;
  createdByHandle?: unknown;
}): NewRound | null {
  const createdByHandle = normalizeHandle(readString(input.createdByHandle) ?? "");
  if (!createdByHandle) return null;
  const title = cleanText(input.title, ROUND_TITLE_MAX) || "Tonight's Round";
  return { title, createdByHandle };
}

/**
 * Validate an untrusted add-stop payload. Returns null when it can't be added: a
 * blank venue id, a blank venue name, or a blank adder handle. `dropRef` is
 * optional (the "builds itself" seam passes it; a manual add omits it).
 */
export function cleanNewStop(input: {
  venueId?: unknown;
  venueName?: unknown;
  addedByHandle?: unknown;
  dropRef?: unknown;
}): NewStop | null {
  const venueId = cleanText(input.venueId, VENUE_ID_MAX);
  const venueName = cleanText(input.venueName, VENUE_NAME_MAX);
  const addedByHandle = normalizeHandle(readString(input.addedByHandle) ?? "");
  if (!venueId || !venueName || !addedByHandle) return null;
  const dropRef = cleanText(input.dropRef, DROP_REF_MAX);
  return {
    venueId,
    venueName,
    addedByHandle,
    ...(dropRef ? { dropRef } : {}),
  };
}
