import "server-only";

import { createHash } from "node:crypto";

import { comparablePint } from "@/lib/comparablePint.mjs";
import { measureFromServingSize } from "@/lib/drinkMeasure";
import { matchesPriceAlert } from "@/lib/priceAlert";
import { dispatchPriceAlert, type PriceAlertDelivery, type PriceAlertEvent, type PriceAlertRecipient } from "@/lib/priceAlertDispatch.server";
import { authoritativeBundleRows, type UkPriceBundleRow } from "@/lib/ukPriceBundle";
import type { VenueRef } from "@/lib/venueIndex";

type Recipient = PriceAlertRecipient & { enabledAt: string };

export function listedPriceAlertId(row: UkPriceBundleRow): string {
  const identity = JSON.stringify([row.venueId, row.lane, row.sourceUrl, row.drinkLabel ?? "", row.servingSize, row.priceGbp, row.observedAt]);
  return `listed:${createHash("sha256").update(identity).digest("hex")}`;
}

export function fingerprintedListedPriceRows(rows: readonly UkPriceBundleRow[]): UkPriceBundleRow[] {
  return authoritativeBundleRows(rows).filter((row) => {
    if (row.category !== "beer" || row.standing !== "listed" || row.lane === "estimate" || !row.sourceUrl || measureFromServingSize(row.servingSize) !== "pint") return false;
    let source = row.publisher?.trim();
    if (!source) {
      try { source = new URL(row.sourceUrl ?? "").hostname.replace(/^www\./, ""); } catch { return false; }
    }
    return Number.isFinite(row.priceGbp) && row.priceGbp > 0 && Number.isFinite(Date.parse(row.observedAt));
  });
}

function eligibleListedPriceRows(rows: readonly UkPriceBundleRow[], now: number = Date.now()): UkPriceBundleRow[] {
  return fingerprintedListedPriceRows(rows).filter((row) => comparablePint({ cheapestPrice: row.priceGbp, priceSource: row.publisher || row.sourceUrl, priceObservedAt: row.observedAt, cheapestPint: row.drinkLabel, measure: "pint" }, now) !== null);
}

export function listedPriceAlertEvents(rows: readonly UkPriceBundleRow[], venues: ReadonlyMap<string, VenueRef>, now: number = Date.now()): PriceAlertEvent[] {
  const events: PriceAlertEvent[] = [];
  for (const row of eligibleListedPriceRows(rows, now)) {
    const venue = venues.get(row.venueId);
    if (!venue || venue.retired) continue;
    let source = row.publisher?.trim();
    if (!source) {
      try { source = new URL(row.sourceUrl ?? "").hostname.replace(/^www\./, ""); } catch { continue; }
    }
    source = source.replace(/\s+/g, " ").slice(0, 80);
    events.push({
      id: listedPriceAlertId(row),
      venueId: row.venueId, venueName: venue.name, lat: venue.lat, lng: venue.lng,
      pricePence: Math.round(row.priceGbp * 100), observedAt: row.observedAt, sourceLabel: source,
      visibility: "public", status: "visible", measure: "pint",
    });
  }
  return events.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
}

export async function dispatchListedPriceAlerts(events: readonly PriceAlertEvent[], recipients: readonly Recipient[], delivery: PriceAlertDelivery, firstSeen: ReadonlyMap<string, string>): Promise<void> {
  for (const recipient of recipients) {
    const enabledAt = Date.parse(recipient.enabledAt);
    if (!Number.isFinite(enabledAt)) continue;
    const event = events.find((candidate) => Date.parse(candidate.observedAt) > enabledAt && Date.parse(firstSeen.get(candidate.id) ?? "") > enabledAt && matchesPriceAlert(recipient, candidate));
    if (!event) continue;
    await dispatchPriceAlert(event, { ...delivery, list: async () => [recipient] });
  }
}
