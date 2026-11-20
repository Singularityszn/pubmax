"use client";

import { useEffect, useMemo, useState } from "react";
import { discardBody } from "@/lib/responseBody";
import { MAX_PUBLIC_PRICE_VENUES, type PublicPricePresence } from "@/lib/publicPricePresence";

type PresenceBatch = {
  controller: AbortController;
  venueIds: Set<string>;
  expiresAt: number;
  result: Promise<Map<string, PublicPricePresence>>;
};
type PresenceRead = { evidence: string; batch: PresenceBatch };
const mapReads = new Map<string, PresenceRead>();
const MAP_READ_REUSE_MS = 60_000;
const MAP_READ_TIMEOUT_MS = 10_000;

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

function retireMapRead(id: string, read: PresenceRead) {
  mapReads.delete(id);
  read.batch.venueIds.delete(id);
  if (read.batch.venueIds.size === 0) read.batch.controller.abort();
}

function retireExpiredOrChangedMapReads(evidenceByVenue: ReadonlyMap<string, string>) {
  const now = Date.now();
  for (const [id, read] of mapReads) {
    const evidence = evidenceByVenue.get(id);
    if (read.batch.expiresAt <= now || (evidence !== undefined && evidence !== read.evidence)) {
      retireMapRead(id, read);
    }
  }
}

function startMapBatch(venueIds: string[], evidenceByVenue: ReadonlyMap<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAP_READ_TIMEOUT_MS);
  const batch: PresenceBatch = {
    controller,
    venueIds: new Set(venueIds),
    expiresAt: Date.now() + MAP_READ_REUSE_MS,
    result: requestPresence(venueIds, controller.signal).finally(() => clearTimeout(timeout)),
  };
  for (const id of venueIds) {
    mapReads.set(id, { evidence: evidenceByVenue.get(id)!, batch });
  }
  void batch.result.then((values) => {
    for (const id of batch.venueIds) {
      const read = mapReads.get(id);
      const value = values.get(id);
      if (read?.batch === batch && (value === undefined || value === "unknown")) {
        retireMapRead(id, read);
      }
    }
  });
}

async function sharedMapPresence(
  venueIds: readonly string[],
  evidenceByVenue: ReadonlyMap<string, string>,
): Promise<Map<string, PublicPricePresence>> {
  const now = Date.now();
  const missing: string[] = [];
  for (const id of venueIds) {
    const read = mapReads.get(id);
    if (read && read.batch.expiresAt > now) continue;
    if (read) retireMapRead(id, read);
    missing.push(id);
  }
  if (missing.length) startMapBatch(missing, evidenceByVenue);

  const values = await Promise.all(venueIds.map(async (id) => {
    const read = mapReads.get(id);
    if (!read || read.evidence !== evidenceByVenue.get(id)) return [id, "unknown"] as const;
    const value = (await read.batch.result).get(id) ?? "unknown";
    return [id, mapReads.get(id) === read ? value : "unknown"] as const;
  }));
  return new Map(values);
}

export function usePublicPricePresence(
  venueIds: readonly string[],
  refreshKey: unknown,
  mapEvidenceByVenue?: ReadonlyMap<string, string>,
): ReadonlyMap<string, PublicPricePresence> {
  const [read, setRead] = useState<{ venueIds: readonly string[]; refreshKey: unknown; values: Map<string, PublicPricePresence> } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (mapEvidenceByVenue) retireExpiredOrChangedMapReads(mapEvidenceByVenue);
    void (async () => {
      for (let start = 0; start < venueIds.length && !controller.signal.aborted; start += MAX_PUBLIC_PRICE_VENUES) {
        const batch = venueIds.slice(start, start + MAX_PUBLIC_PRICE_VENUES);
        try {
          const values = await (mapEvidenceByVenue
            ? sharedMapPresence(batch, mapEvidenceByVenue)
            : requestPresence(batch, controller.signal));
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
  }, [venueIds, refreshKey, mapEvidenceByVenue]);
  return useMemo(() => read?.venueIds === venueIds && read.refreshKey === refreshKey ? read.values : new Map(), [read, venueIds, refreshKey]);
}

