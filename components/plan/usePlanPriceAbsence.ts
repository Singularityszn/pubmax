"use client";

import { useEffect, useState } from "react";

const UNKNOWN = new Set<string>();

export function usePlanPriceAbsence(venueIds: readonly string[], refreshKey: number): ReadonlySet<string> {
  const [read, setRead] = useState<{
    venueIds: readonly string[];
    refreshKey: number;
    absent: ReadonlySet<string>;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    for (const venueId of venueIds) {
      void (async () => {
        try {
          const [drops, prices] = await Promise.all(
            ["/api/pint-drops", "/api/price-submit"].map(async (path) => {
              const response = await fetch(`${path}?venueId=${encodeURIComponent(venueId)}`, { signal: controller.signal });
              if (!response.ok) throw new Error("Price read unavailable");
              return response.json();
            }),
          );
          if (controller.signal.aborted || !drops || !prices || drops.degraded || prices.degraded
            || !Array.isArray(drops.drops) || !Array.isArray(prices.prices)) return;
          if (!drops.drops.every((row: { priceGbp?: unknown } | null) => row && typeof row === "object" && row.priceGbp === null)
            || !prices.prices.every((row: { drinkCategory?: unknown } | null) => row && typeof row === "object" && typeof row.drinkCategory === "string" && row.drinkCategory !== "beer")) return;
          setRead((current) => ({
            venueIds,
            refreshKey,
            absent: new Set([
              ...(current?.venueIds === venueIds && current.refreshKey === refreshKey ? current.absent : []),
              venueId,
            ]),
          }));
        } catch {
          return;
        }
      })();
    }
    return () => controller.abort();
  }, [venueIds, refreshKey]);

  return read?.venueIds === venueIds && read.refreshKey === refreshKey ? read.absent : UNKNOWN;
}
