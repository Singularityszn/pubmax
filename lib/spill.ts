// Pure helpers for "The Spill" composer upgrade (issue #24): price
// stepper/quick-add math, the "with" structured-suffix builder, and a thin
// re-export of the visibility allowlist for composer-side validation reuse.
// No React, no DOM — these are unit-testable in isolation.

export { VISIBILITIES, DEFAULT_VISIBILITY, cleanVisibility } from "@/lib/pintDrops";
export type { Visibility } from "@/lib/pintDrops";

// ── Price stepper ───────────────────────────────────────────────────────────
// Mirrors the server's MAX_PRICE clamp (lib/pintDrops.ts) on the low end (a
// pint can't be £0 or negative) and the high end (£20) so the stepper can
// never walk the field somewhere the server would reject anyway. The step is
// 10p, matching real pint pricing granularity.
export const PRICE_STEP_GBP = 0.1;
export const MIN_PRICE_GBP = 0.1;
export const MAX_PRICE_GBP = 20;

// Quick-add chips: the common price points a pint actually lands on.
export const QUICK_ADD_PRICES_GBP = [4, 4.5, 5, 5.5, 6, 6.9] as const;

/** Round to the nearest penny — floating point addition (0.1 + 0.2, etc.)
 *  otherwise drifts the displayed price by fractions of a penny. */
function roundToPenny(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Clamp a price into the valid pint range, rounded to the penny. NaN
 *  collapses to the minimum; +/-Infinity clamp to the max/min respectively —
 *  the stepper must always produce a sane, displayable value, never NaN. */
export function clampPriceGbp(value: number): number {
  if (Number.isNaN(value)) return MIN_PRICE_GBP;
  return roundToPenny(Math.min(MAX_PRICE_GBP, Math.max(MIN_PRICE_GBP, value)));
}

/**
 * Step a price string up or down by PRICE_STEP_GBP, clamped to the valid
 * range. An empty/unparseable current value steps from the first quick-add
 * price (£4) rather than from 0, so a single tap on "+" from empty lands
 * somewhere sane instead of at 10p.
 */
export function stepPrice(current: string, direction: 1 | -1): string {
  const parsed = Number(current);
  const base = current.trim() === "" || !Number.isFinite(parsed) ? QUICK_ADD_PRICES_GBP[0] : parsed;
  const next = clampPriceGbp(base + direction * PRICE_STEP_GBP);
  return formatPriceGbp(next);
}

/** Format a numeric price for the input field: trim to at most 2 decimal
 *  places, no trailing zeros beyond what's needed (e.g. 4 -> "4", 4.5 ->
 *  "4.5", 4.9999999 -> "5"). */
export function formatPriceGbp(value: number): string {
  const rounded = roundToPenny(value);
  return String(rounded);
}

// ── "With" field → structured note suffix ───────────────────────────────────
// The API has no `with` column (frozen contract) — the ponytail choice is to
// fold it into passedDownNote as a suffix at submit time: "— with @sam, @priya".
// This is intentionally lossy/append-only so every existing surface that
// renders passedDownNote (feed, permalink, ledger) gets "with" for free,
// without a migration. A real column can replace this later.
const WITH_SEPARATOR_RE = /[,\s]+/;
const MAX_WITH_ENTRIES = 6;
const MAX_WITH_ENTRY_LEN = 30;

/** Split a free-text "with" input into individual entries (comma and/or
 *  whitespace separated), trimmed, capped in count and per-entry length.
 *  A bare word is kept as free text; an `@handle`-shaped token keeps its `@`. */
export function parseWithEntries(value: string): string[] {
  if (typeof value !== "string") return [];
  const parts = value
    .split(WITH_SEPARATOR_RE)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.slice(0, MAX_WITH_ENTRY_LEN));
  const out: string[] = [];
  for (const part of parts) {
    if (!out.includes(part)) out.push(part);
    if (out.length >= MAX_WITH_ENTRIES) break;
  }
  return out;
}

/**
 * Build the structured suffix to append to a note, e.g. "— with @sam, @priya".
 * Returns "" when there's nothing to say, so callers can unconditionally
 * concatenate without extra branching.
 */
export function buildWithSuffix(withValue: string): string {
  const entries = parseWithEntries(withValue);
  if (entries.length === 0) return "";
  return `— with ${entries.join(", ")}`;
}

/**
 * Append the "with" suffix onto a note, joining with a space when the note is
 * non-empty. Idempotent-ish in spirit (callers only call this once, at
 * submit time) but pure/deterministic either way.
 */
export function appendWithSuffix(note: string, withValue: string): string {
  const suffix = buildWithSuffix(withValue);
  if (!suffix) return note;
  const trimmedNote = note.trim();
  return trimmedNote ? `${trimmedNote} ${suffix}` : suffix;
}
