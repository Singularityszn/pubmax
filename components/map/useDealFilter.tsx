"use client";

import { useEffect, useMemo, useState } from "react";
import { useDealPrices } from "@/components/map/useDealPrices";
import { dealAvailableNow } from "@/lib/dealSchedule";

export function useDealFilter() {
  const [enabled, setEnabled] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const result = useDealPrices(undefined, enabled);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const nextMinute = current + 60_000 - current % 60_000;
      const expiries = result.deals.filter((deal) => deal.endDate === null)
        .map((deal) => Date.parse(deal.reportedAt) + 30 * 24 * 60 * 60 * 1000 + 1)
        .filter((time) => Number.isFinite(time) && time > current);
      timer = setTimeout(tick, Math.min(nextMinute, ...expiries) - current);
    };
    const resume = () => { clearTimeout(timer); tick(); };
    timer = setTimeout(tick, 0);
    document.addEventListener("visibilitychange", resume);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, [enabled, result.deals]);
  const ids = useMemo(() => enabled
    ? new Set(result.deals.filter((deal) => dealAvailableNow(deal, new Date(now))).map((deal) => deal.venueId))
    : null, [enabled, result.deals, now]);
  const control = <div className="dealFilter venueFeatureFilters">
    <div className="venueFeatureFiltersChoices"><button type="button" aria-pressed={enabled} onClick={() => { setNow(Date.now()); setEnabled((value) => !value); }}>Deal on now</button></div>
    {enabled && result.status === "loading" ? <p role="status">Checking deals…</p> : null}
    {enabled && result.status === "unavailable" ? <p role="status">Deals are unavailable right now. Try again later.</p> : null}
  </div>;
  return { enabled, ids, control, setEnabled, reading: enabled && result.status === "loading", failed: enabled && result.status === "unavailable" };
}
