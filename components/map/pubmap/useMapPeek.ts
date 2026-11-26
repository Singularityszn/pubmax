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
  viewStatus: "loading" | "unread" | "ready";
}): MapPeekModel | null {
  const { cityId, projection, hidden, phone, unavailable, venues, lensPrices, lensStatus, venueSignals, reader } = input;
  const ready = projection?.cityId === cityId && input.viewStatus === "ready";
  const peek = useMemo(
    () => buildMapPeek({ ready, venues, lensPrices, lensStatus, venueSignals, reader }),
    [lensPrices, lensStatus, reader, ready, venueSignals, venues],
  );
  return hidden || !phone ? null : unavailable ? { status: "unavailable" } : input.viewStatus === "unread" ? { status: "unread" } : peek;
}
