"use client";

import { useMemo } from "react";

import type { PriceStandingDecision } from "@/lib/priceTier";
import type { Venue } from "@/lib/venues";
import { zoneEstimatePinStandings } from "@/lib/zonePriceEstimate";
import type { ZonePintIndex } from "@/lib/zones";

type PinSignals = Parameters<typeof zoneEstimatePinStandings>[1];

/**
 * The price standing each map pin may claim. A favourite pint owns the pin
 * labels, so it leaves no estimate. A pint price cap leaves no estimate either.
 */
export function usePinPriceStandings(
  venues: readonly Venue[],
  signals: PinSignals,
  zoneIndex: ZonePintIndex | null | undefined,
  favoritePint: string | null,
  pintCap: number,
): ReadonlyMap<string, PriceStandingDecision> | null {
  return useMemo(
    () => (favoritePint ? null : zoneEstimatePinStandings(venues, signals, zoneIndex, pintCap)),
    [venues, signals, zoneIndex, favoritePint, pintCap],
  );
}
