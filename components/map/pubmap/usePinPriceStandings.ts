"use client";

import { useMemo } from "react";

import type { PriceStandingDecision } from "@/lib/priceTier";
import type { Venue } from "@/lib/venues";
import { zoneEstimatePinStandings, type VenuePriceReads } from "@/lib/zonePriceEstimate";
import type { ZonePintIndex } from "@/lib/zones";

type PinSignals = Parameters<typeof zoneEstimatePinStandings>[1];

/**
 * The price standing each map pin may claim. A favourite pint owns the pin
 * labels, so it leaves no estimate. A pub whose own price or drop read is in
 * flight has no estimate until that read settles.
 */
export function usePinPriceStandings(
  venues: readonly Venue[],
  signals: PinSignals,
  zoneIndex: ZonePintIndex | null | undefined,
  favoritePint: string | null,
  reads: VenuePriceReads,
): ReadonlyMap<string, PriceStandingDecision> | null {
  const { price, drops } = reads;
  return useMemo(
    () => (favoritePint ? null : zoneEstimatePinStandings(venues, signals, zoneIndex, { price, drops })),
    [venues, signals, zoneIndex, favoritePint, price, drops],
  );
}
