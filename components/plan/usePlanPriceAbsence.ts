"use client";

import { useMemo } from "react";
import { usePublicPricePresence } from "@/components/usePublicPricePresence";

export function usePlanPriceAbsence(venueIds: readonly string[], refreshKey: number): ReadonlySet<string> {
  const presence = usePublicPricePresence(venueIds, refreshKey);
  return useMemo(() => new Set([...presence].filter(([, value]) => value === "absent").map(([id]) => id)), [presence]);
}
