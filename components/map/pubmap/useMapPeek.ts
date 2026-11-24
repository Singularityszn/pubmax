"use client";

import { useMemo } from "react";
import type { CityId } from "@/lib/cities";
import { buildMapPeek, type MapPeekModel } from "@/lib/mapPeek";

export function useMapPeek(input: Omit<Parameters<typeof buildMapPeek>[0], "ready"> & {
  cityId: CityId;
  projection: { cityId: CityId } | null;
  hidden: boolean;
  phone: boolean;
  unavailable: boolean;
  viewReady: boolean;
}): MapPeekModel | null {
  const { cityId, projection, hidden, phone, unavailable, venues, lensPrices, lensStatus, venueSignals, reader } = input;
  const ready = projection?.cityId === cityId && input.viewReady;
  const peek = useMemo(
    () => buildMapPeek({ ready, venues, lensPrices, lensStatus, venueSignals, reader }),
    [lensPrices, lensStatus, reader, ready, venueSignals, venues],
  );
  return hidden || !phone ? null : unavailable ? { status: "unavailable" } : peek;
}
