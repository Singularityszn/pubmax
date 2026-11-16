"use client";

import { useMemo } from "react";
import type { DraftStop } from "@/components/plan/PlanComposer";
import { usePublicPricePresence } from "@/components/usePublicPricePresence";
import type { PlanVenueOption } from "@/lib/planVenueOptions";
import { priceStandingFigure, priceStandingFor } from "@/lib/priceTier";
import { zonePriceEstimate } from "@/lib/zonePriceEstimate";
import { zoneLabel, type ZonePintIndex } from "@/lib/zones";

export type StopZoneEstimate = { stamp: { text: string; bandClass: string }; label: string } | null;

export function stopZoneEstimate(
  stop: DraftStop,
  venue: PlanVenueOption | undefined,
  zoneIndex: ZonePintIndex | null,
): StopZoneEstimate {
  if (stop.selectedDrinkPriceEvidence || typeof stop.estimatedPintPricePence === "number" || venue?.hasRecordedPrice !== false) return null;
  const estimate = zonePriceEstimate(venue?.zone, zoneIndex);
  const text = estimate ? priceStandingFigure(priceStandingFor({ estimate })) : null;
  return estimate && text ? { stamp: { text, bandClass: "" }, label: `${zoneLabel(estimate.zone)} estimate` } : null;
}

export function usePlanPriceAbsence(
  stops: readonly DraftStop[],
  venues: readonly PlanVenueOption[],
  zoneIndex: ZonePintIndex | null,
  refreshKey: number,
) {
  const venueById = useMemo(() => new Map(venues.map((venue) => [venue.id, venue])), [venues]);
  const venueIds = useMemo(() => [...new Set(stops
    .filter((stop) => (stop.priceKind === "estimated" && !stop.selectedDrinkPriceEvidence)
      || stopZoneEstimate(stop, venueById.get(stop.venueId), zoneIndex))
    .map((stop) => stop.venueId))], [stops, venueById, zoneIndex]);
  const presence = usePublicPricePresence(venueIds, refreshKey);
  const publicPriceAbsent = useMemo(() => new Set([...presence]
    .filter(([, value]) => value === "absent").map(([id]) => id)), [presence]);
  const priceStops = useMemo(() => stops.map((stop) => stop.priceKind === "estimated" && !publicPriceAbsent.has(stop.venueId)
    ? { ...stop, estimatedPintPricePence: undefined, priceKind: undefined } : stop), [stops, publicPriceAbsent]);
  return { priceStops, publicPriceAbsent };
}
