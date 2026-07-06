import { buildVenueClaims, type ClaimDrop, type Provenance, type VenueClaim } from "@/lib/curation";
import { displayHandle } from "@/lib/handleDisplay";

// The Ledger (issue #25, PRD_FOR_FABLE.md § "The Spill"): a large-text,
// voice-friendly logbook rendering of a venue's Pint Drops — "the story of
// this place" for the Boomer/Gen-X reading surface. This module is the ONE
// pure seam: turn a venue's visible Pint Drops into dated logbook entries,
// newest first. No IO here — the route/page does the fetching, this just
// composes and sorts, so it stays trivially unit-testable.

// The minimal drop shape the ledger needs. A structural subset of PintDropDTO
// (lib/pintDropsStore.ts) so this file never imports the Supabase-backed store
// directly — it only needs plain data, not the storage seam.
export type LedgerSourceDrop = {
  id: string;
  handle: string;
  drink: string;
  priceGbp: number | null;
  passedDownNote: string;
  era: string;
  provenance: Provenance;
  createdAt: string;
};

export type LedgerEntry = {
  id: string;
  // ISO timestamp, kept for <time dateTime=…>; entries with no parseable date
  // sort last and render without a dateLabel.
  createdAt: string;
  dateLabel: string | null;
  handle: string;
  headline: string;
  note: string;
  priceLabel: string | null;
  era: string;
  provenance: Provenance;
};

function formatGbp(value: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `£${value.toFixed(2)}`
    : null;
}

// en-GB long date for the ruled logbook line, e.g. "3 June 2024". Returns null
// for an unparseable/missing timestamp rather than throwing — the entry still
// renders, just without a date.
export function formatLedgerDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// One drop -> one logbook entry. The note is the prominent line (a passed-down
// memory reads like a diary entry); a priced-but-noteless drop falls back to
// "Logged <drink> at <price>" so the ledger never renders an empty entry.
export function toLedgerEntry(drop: LedgerSourceDrop): LedgerEntry {
  const priceLabel = formatGbp(drop.priceGbp);
  const headline = drop.drink || "A pint logged";
  const note =
    drop.passedDownNote ||
    (priceLabel ? `Logged ${drop.drink || "a pint"} at ${priceLabel}.` : "");

  return {
    id: drop.id,
    createdAt: drop.createdAt,
    dateLabel: formatLedgerDate(drop.createdAt),
    handle: displayHandle(drop.handle),
    headline,
    note,
    priceLabel,
    era: drop.era,
    provenance: drop.provenance,
  };
}

/**
 * Compose the full ledger: every drop with something to show (a note or a
 * price), newest first. Pure — no IO, no clock reads — so it is unit-testable
 * with plain fixtures. Drops with neither a note nor a price are dropped
 * silently (nothing to log), matching buildVenueClaims' rule that an empty
 * claim never renders.
 */
export function buildLedgerEntries(drops: LedgerSourceDrop[]): LedgerEntry[] {
  return drops
    .map(toLedgerEntry)
    .filter((entry) => entry.note.length > 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── The Family Table (issue #27) ──────────────────────────────────────────
// Legacy drops (visibility: "legacy", issue #29) are a family-lane, NOT an
// anonymous one: unlike the public logbook, an entry here is always attributed
// to the handle that left it (heirloom notes are meant to be traced back to
// whoever in the family logged them). Reuses toLedgerEntry/LedgerEntry as-is —
// same shape, same sort — so the page can render both sections with one
// component if it ever wants to; the split is purely which array a drop came
// from (public listVisible vs. the ledger-only listLegacyForVenue).
export type FamilyTableEntry = LedgerEntry;

/**
 * Compose the Family Table: every LEGACY drop with something to show (a note
 * or a price), newest first. Callers MUST source `drops` from
 * PintDropStore.listLegacyForVenue — never from listVisible, which already
 * excludes legacy rows server-side. Kept as a distinctly-named function (not
 * a `buildLedgerEntries` reuse) so a call site can't accidentally feed the
 * public list in here and call it "the family table".
 */
export function buildFamilyTableEntries(drops: LedgerSourceDrop[]): FamilyTableEntry[] {
  return drops
    .map(toLedgerEntry)
    .filter((entry) => entry.note.length > 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── One-tap share-with-family (issue #27) ─────────────────────────────────
// Smallest honest implementation: build the exact strings navigator.share (or
// a mailto: fallback) needs, as a pure function the page/component can test
// without touching the browser Share API. No email infrastructure here — see
// ShareWithFamilyText below for the ponytail-ceiling note (real digest emails
// are a later, backend-shaped project).
export type ShareWithFamilyText = {
  /** navigator.share's `title` field. */
  title: string;
  /** navigator.share's `text` field — the note, attributed to the pub. */
  text: string;
  /** The page URL to include (navigator.share's `url`, and the mailto body). */
  url: string;
  /** A `mailto:` href with subject/body prefilled, for browsers/contexts
   *  without the Web Share API (desktop Safari/Firefox, most desktop browsers
   *  as of today). */
  mailtoHref: string;
};

/**
 * Build the share strings for one Family Table entry (or, with `note`
 * omitted, for the section as a whole). Pure — no `navigator`, no `window` —
 * so it's unit-testable and the component just wires the result to
 * `navigator.share` / an <a href> fallback.
 */
export function buildFamilyShareText(params: {
  venueName: string;
  note: string;
  url: string;
}): ShareWithFamilyText {
  const { venueName, url } = params;
  const note = params.note.trim();
  const title = venueName;
  const text = note
    ? `${note}\n— from the family table at ${venueName}`
    : `The family table at ${venueName}`;
  const subject = `The family table at ${venueName}`;
  const body = `${text}\n\n${url}`;
  const mailtoHref = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return { title, text, url, mailtoHref };
}

// Bridge into the existing claims model (heritage + drops) for anywhere the
// Ledger wants the same provenance-stamped claim list the venue detail uses —
// kept here (rather than duplicated) so heritage claims and logbook entries
// share one source of truth for provenance labelling.
export function ledgerClaimDrops(drops: LedgerSourceDrop[]): ClaimDrop[] {
  return drops.map((d) => ({
    handle: d.handle,
    drink: d.drink,
    priceGbp: d.priceGbp,
    passedDownNote: d.passedDownNote,
    era: d.era,
    provenance: d.provenance,
  }));
}

export type { VenueClaim };
export { buildVenueClaims };
