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
