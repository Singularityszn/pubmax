import "server-only";

// The ONE direction Price Pulse and the price lanes meet: a line that names a
// pub on our map may print the pub's Confirmed PUBMAXX price beside the claim,
// with the price's own date. Nothing flows the other way (lib/pricePulse.ts).
//
// Only `confirmed` counts. A corroborated or single drop is not a price we
// stand behind, so the line keeps its "Not checked by PUBMAXX" label. A read
// that fails is null for the same reason readVenuePintTrust's is: a caller
// that cannot read the state must not claim one.

import { log } from "@/lib/log";
import type { PricePulseEdition } from "@/lib/pricePulse";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { pintTrustFor } from "@/lib/pintTrust";
import { priceStandingFor, type PriceStandingDecision } from "@/lib/priceTier";

/** A `confirmed` standing decided by lib/priceTier.ts, ready for TrustPill. */
export type PulseConfirmedPrice = PriceStandingDecision & { standing: "confirmed" };

async function confirmedPriceFor(venueId: string, now: number): Promise<PulseConfirmedPrice | null> {
  try {
    const candidates = await pintDropsStore().listConfirmationCandidates(venueId);
    const reading = pintTrustFor(candidates, now);
    if (reading.state !== "confirmed" || !reading.confirmedPrice) return null;
    const decision = priceStandingFor({ confirmed: reading.confirmedPrice }, now);
    return decision.standing === "confirmed" ? (decision as PulseConfirmedPrice) : null;
  } catch (err) {
    log("warn", "price_pulse.confirmed_read_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Confirmed prices for every venue the editions name, keyed by venue id. */
export async function confirmedPricesForEditions(
  editions: readonly PricePulseEdition[],
  now: number = Date.now(),
): Promise<Map<string, PulseConfirmedPrice>> {
  const venueIds = [
    ...new Set(editions.flatMap((edition) => edition.items.flatMap((item) => (item.venueId ? [item.venueId] : [])))),
  ];
  const prices = new Map<string, PulseConfirmedPrice>();
  const readings = await Promise.all(venueIds.map(async (id) => [id, await confirmedPriceFor(id, now)] as const));
  for (const [id, price] of readings) if (price) prices.set(id, price);
  return prices;
}
