"use client";

import { useEffect, useMemo, useState } from "react";
import { discardBody } from "@/lib/responseBody";
import { MAX_PUBLIC_PRICE_VENUES, type PublicPricePresence } from "@/lib/publicPricePresence";

export function usePublicPricePresence(venueIds: readonly string[], refreshKey: unknown): ReadonlyMap<string, PublicPricePresence> {
  const [read, setRead] = useState<{ venueIds: readonly string[]; refreshKey: unknown; values: Map<string, PublicPricePresence> } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      for (let start = 0; start < venueIds.length && !controller.signal.aborted; start += MAX_PUBLIC_PRICE_VENUES) {
        const batch = venueIds.slice(start, start + MAX_PUBLIC_PRICE_VENUES);
        try {
          const params = new URLSearchParams({ scope: "public-price-presence" });
          batch.forEach((id) => params.append("venueId", id));
          const response = await fetch(`/api/price-submit?${params}`, { signal: controller.signal, cache: "no-store" });
          if (!response.ok) { discardBody(response); continue; }
          const body = await response.json();
          if (controller.signal.aborted || !body?.presence || body.degraded) continue;
          const values = batch.map((id) => [id, body.presence[id] === "absent" || body.presence[id] === "present" ? body.presence[id] : "unknown"] as const);
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

