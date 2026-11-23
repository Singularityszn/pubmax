// The pint list a pub's own page prints: one row per pour, cheapest first, and
// the receipt each figure stands on. A pure read over the venue's price rows.

import { answerEvidenceFor, type AnswerPublisher } from "@/lib/landingHero";
import type { VenuePrice } from "@/lib/venues";

export type PintReceipt = { publisher: AnswerPublisher | null; observedOn: string | null };
export type PubPintRow = { name: string; price: number; receipt: PintReceipt };

/**
 * "BIRRA MORETTI" reads as a shout; the source files some names in capitals.
 * A letter is raised only where a word starts, so "WESTON'S" keeps its small s.
 */
export function pintDisplayName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** The cheapest price per pint name, cheapest first: one row per pour. */
export function pubPintRows(prices: readonly VenuePrice[]): PubPintRow[] {
  const cheapest = new Map<string, { name: string; price: number; rows: VenuePrice[] }>();
  for (const row of prices) {
    if (typeof row.price_gbp !== "number" || !Number.isFinite(row.price_gbp) || row.price_gbp <= 0 || !row.pint_name.trim()) continue;
    const key = row.pint_name.trim().toLowerCase();
    const held = cheapest.get(key);
    if (held) {
      held.rows.push(row);
      held.price = Math.min(held.price, row.price_gbp);
    } else cheapest.set(key, { name: pintDisplayName(row.pint_name.trim()), price: row.price_gbp, rows: [row] });
  }
  return [...cheapest.values()].sort((a, b) => a.price - b.price || a.name.localeCompare(b.name))
    .map(({ rows, ...pint }) => {
      const { publisher, observedOn } = answerEvidenceFor({ priceGbp: pint.price, prices: rows.filter((row) => row.price_gbp === pint.price) });
      return { ...pint, receipt: { publisher, observedOn } };
    });
}

export function samePintReceipt(a: PintReceipt, b: PintReceipt): boolean {
  return a.observedOn === b.observedOn
    && (a.publisher?.label ?? null) === (b.publisher?.label ?? null)
    && (a.publisher?.url ?? null) === (b.publisher?.url ?? null);
}

/**
 * The receipt a list prints once, above its rows: the one most rows stand on,
 * when at least two do. A row never borrows it. A row on another publisher,
 * link or day keeps its own line (`samePintReceipt` decides which).
 */
export function sharedPintReceipt(rows: readonly PubPintRow[]): PintReceipt | null {
  let shared: PintReceipt | null = null;
  let most = 1;
  for (const { receipt } of rows) {
    const count = rows.filter((row) => samePintReceipt(row.receipt, receipt)).length;
    if (count > most) [shared, most] = [receipt, count];
  }
  return shared;
}
