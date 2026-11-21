"use client";

import { useEffect, useMemo, useState } from "react";
import { MAX_PUBLIC_PRICE_VENUES, type PublicPricePresence } from "@/lib/publicPricePresence";
import { discardBody } from "@/lib/responseBody";

const reads = new Map<string, { value: PublicPricePresence; expiresAt: number }>();
const REUSE_MS = 60_000;
const MAX_READS = 5000;

export function useBasePricePresence(ids: readonly string[], evidence: ReadonlyMap<string, string>): ReadonlyMap<string, PublicPricePresence> {
  const key = JSON.stringify(ids.map((id) => [id, evidence.get(id) ?? ""]));
  const [read, setRead] = useState<{ key: string; values: Map<string, PublicPricePresence> } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const requested = JSON.parse(key) as [string, string][];
    void (async () => {
      const known = new Map<string, PublicPricePresence>();
      const missing: [string, string][] = [];
      for (const [id, stamp] of requested) {
        const cacheKey = JSON.stringify([id, stamp]);
        const cached = reads.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) known.set(id, cached.value);
        else { reads.delete(cacheKey); missing.push([id, stamp]); }
      }
      if (known.size && !controller.signal.aborted) setRead({ key, values: known });
      for (let start = 0; start < missing.length && !controller.signal.aborted; start += MAX_PUBLIC_PRICE_VENUES) {
        const entries = missing.slice(start, start + MAX_PUBLIC_PRICE_VENUES);
        const batch = entries.map(([id]) => id);
        const params = new URLSearchParams({ scope: "base-price-presence" });
        batch.forEach((id) => params.append("venueId", id));
        const batchController = new AbortController();
        const abortBatch = () => batchController.abort();
        controller.signal.addEventListener("abort", abortBatch, { once: true });
        const timeout = setTimeout(abortBatch, 10_000);
        try {
          const response = await fetch(`/api/price-submit?${params}`, { signal: batchController.signal, cache: "no-store" });
          if (!response.ok) { discardBody(response); continue; }
          const body = await response.json();
          if (controller.signal.aborted) return;
          const values = batch.map((id) => [id, body?.presence?.[id] === "absent" || body?.presence?.[id] === "present" ? body.presence[id] : "unknown"] as [string, PublicPricePresence]);
          for (const [id, value] of values) {
            if (value === "unknown") continue;
            const stamp = entries.find(([candidate]) => candidate === id)?.[1] ?? "";
            reads.set(JSON.stringify([id, stamp]), { value, expiresAt: Date.now() + REUSE_MS });
          }
          while (reads.size > MAX_READS) reads.delete(reads.keys().next().value!);
          setRead((current) => ({ key, values: new Map([...(current?.key === key ? current.values : []), ...values]) }));
        } catch {
          // An unavailable source cannot establish absence.
        } finally {
          clearTimeout(timeout);
          controller.signal.removeEventListener("abort", abortBatch);
        }
      }
    })();
    return () => controller.abort();
  }, [key]);
  return useMemo(() => read?.key === key ? read.values : new Map(), [key, read]);
}
