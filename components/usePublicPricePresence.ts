"use client";

import { useEffect, useMemo, useState } from "react";
import { discardBody } from "@/lib/responseBody";
import { MAX_PUBLIC_PRICE_VENUES, type PublicPricePresence } from "@/lib/publicPricePresence";

type PresenceRead = { expiresAt: number; result: Promise<Map<string, PublicPricePresence>> };
const mapReads = new Map<string, PresenceRead>();
const MAP_READ_REUSE_MS = 60_000;

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

async function sharedMapPresence(batch: readonly string[]): Promise<Map<string, PublicPricePresence>> {
  const now = Date.now();
  for (const [id, read] of mapReads) {
    if (read.expiresAt <= now) mapReads.delete(id);
  }
  const missing = batch.filter((id) => !mapReads.has(id));
  if (missing.length) {
    // Navigation must not abort a request another mounted map still needs.
    const read: PresenceRead = {
      expiresAt: now + MAP_READ_REUSE_MS,
      result: requestPresence(missing, AbortSignal.timeout(10_000)),
    };
    for (const id of missing) mapReads.set(id, read);
    void read.result.then((values) => {
      for (const id of missing) {
        if ((!values.has(id) || values.get(id) === "unknown") && mapReads.get(id) === read) mapReads.delete(id);
      }
    });
  }
  const reads = batch.map((id) => [id, mapReads.get(id)!] as const);
  const values = await Promise.all(reads.map(async ([id, read]) => [id, (await read.result).get(id) ?? "unknown"] as const));
  return new Map(values);
}

export function usePublicPricePresence(venueIds: readonly string[], refreshKey: unknown, shareMapReads = false): ReadonlyMap<string, PublicPricePresence> {
  const [read, setRead] = useState<{ venueIds: readonly string[]; refreshKey: unknown; values: Map<string, PublicPricePresence> } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      for (let start = 0; start < venueIds.length && !controller.signal.aborted; start += MAX_PUBLIC_PRICE_VENUES) {
        const batch = venueIds.slice(start, start + MAX_PUBLIC_PRICE_VENUES);
        try {
          const values = await (shareMapReads ? sharedMapPresence(batch) : requestPresence(batch, controller.signal));
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
  }, [venueIds, refreshKey, shareMapReads]);
  return useMemo(() => read?.venueIds === venueIds && read.refreshKey === refreshKey ? read.values : new Map(), [read, venueIds, refreshKey]);
}

