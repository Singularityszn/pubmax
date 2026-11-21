"use client";

import { useEffect, useMemo, useState } from "react";
import { discardBody } from "@/lib/responseBody";
import { MAX_PUBLIC_PRICE_VENUES, type PublicPricePresence } from "@/lib/publicPricePresence";

async function requestPresence(batch: readonly string[], signal: AbortSignal): Promise<Map<string, PublicPricePresence>> {
  try {
    const params = new URLSearchParams({ scope: "public-price-presence" });
    batch.forEach((id) => params.append("venueId", id));
    const response = await fetch(`/api/price-submit?${params}`, { signal, cache: "no-store" });
    if (!response.ok) { discardBody(response); return new Map(); }
    const body = await response.json();
    if (!body?.presence || body.degraded) return new Map();
    return new Map(batch.map((id) => [id, body.presence[id] === "absent" || body.presence[id] === "present" ? body.presence[id] : "unknown"]));
  } catch {
    return new Map();
  }
}

export function usePublicPricePresence(
  venueIds: readonly string[],
  refreshKey: unknown,
): ReadonlyMap<string, PublicPricePresence> {
  const [read, setRead] = useState<{ venueIds: readonly string[]; refreshKey: unknown; values: Map<string, PublicPricePresence> } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      for (let start = 0; start < venueIds.length && !controller.signal.aborted; start += MAX_PUBLIC_PRICE_VENUES) {
        const batch = venueIds.slice(start, start + MAX_PUBLIC_PRICE_VENUES);
        try {
          const values = await requestPresence(batch, controller.signal);
          if (controller.signal.aborted) return;
          setRead((current) => ({ venueIds, refreshKey, values: new Map([
            ...(current?.venueIds === venueIds && current.refreshKey === refreshKey ? current.values : []), ...values,
          ]) }));
        } catch {
          if (controller.signal.aborted) return;
        }
      }
    })();
    return () => controller.abort();
  }, [venueIds, refreshKey]);
  return useMemo(() => read?.venueIds === venueIds && read.refreshKey === refreshKey ? read.values : new Map(), [read, venueIds, refreshKey]);
}

