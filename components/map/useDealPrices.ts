"use client";

import { useEffect, useMemo, useState } from "react";
import { dealIsVisible, nextLondonMidnight } from "@/lib/dealSchedule";
import { validateDealPrice, type DealPrice } from "@/lib/dealPrice";

export type DealPriceRead = { status: "loading" | "ready" | "unavailable"; deals: DealPrice[]; venueId?: string };

export function useDealPrices(venueId?: string, enabled = true): DealPriceRead {
  const [result, setResult] = useState<DealPriceRead>({ status: "loading", deals: [] });
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const current = Date.now();
      setNow(current);
      timer = setTimeout(schedule, nextLondonMidnight(current) - current + 1);
    };
    const resume = () => { clearTimeout(timer); schedule(); };
    timer = setTimeout(schedule, nextLondonMidnight(Date.now()) - Date.now() + 1);
    document.addEventListener("visibilitychange", resume);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, [enabled]);
  useEffect(() => {
    const update = () => setRevision((value) => value + 1);
    window.addEventListener("pubmax:deals-changed", update);
    return () => window.removeEventListener("pubmax:deals-changed", update);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const url = venueId ? `/api/deal-prices?venueId=${encodeURIComponent(venueId)}` : "/api/deal-prices";
    void fetch(url, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Deal read failed");
      const data = await response.json();
      if (!Array.isArray(data.deals)) throw new Error("Invalid deal read");
      const deals = data.deals.map((row: Record<string, unknown>) => {
        const parsed = validateDealPrice(row);
        if (!parsed.ok || typeof row.id !== "string" || typeof row.reportedAt !== "string") throw new Error("Invalid deal");
        return { ...parsed.value, id: row.id, reportedAt: row.reportedAt };
      });
      setResult({ status: "ready", deals, venueId });
    }).catch(() => { if (!controller.signal.aborted) setResult({ status: "unavailable", deals: [], venueId }); });
    return () => controller.abort();
  }, [venueId, enabled, revision]);
  const visible = useMemo(() => result.deals.filter((deal) => dealIsVisible(deal, new Date(now))), [result.deals, now]);
  return result.venueId === venueId ? { ...result, deals: visible } : { status: "loading", deals: [] };
}
