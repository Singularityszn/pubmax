"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDealPrices, type DealPriceRead } from "@/components/map/useDealPrices";
import { drinkMeasureName } from "@/lib/drinkMeasure";
import { formatGbp } from "@/lib/formatGbp";
import { dealAvailableNow } from "@/lib/dealSchedule";
import { NO_ALCOHOL_DRINK_CATEGORIES } from "@/lib/communityPrice";
import type { DrinkCategory } from "@/lib/drinks";
import type { MapExperienceLens } from "@/lib/mapExperienceLens";
import "./dealPrices.css";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type DealPriceLens = {
  experienceLens: MapExperienceLens;
  drinkLensCategory?: DrinkCategory | null;
};

export default function VenueDealPrices({ venueId, ...lens }: { venueId: string } & DealPriceLens) {
  const result = useDealPrices(venueId);
  return <VenueDealPricesView result={result} {...lens} />;
}

export function VenueDealPricesView({ result: { deals, status }, experienceLens, drinkLensCategory }: { result: DealPriceRead } & DealPriceLens) {
  const [report, setReport] = useState<{ id: string; state: "sending" | "sent" | "failed" } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== "ready" || !deals.length) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const expiries = deals.filter((deal) => deal.endDate === null)
        .map((deal) => Date.parse(deal.reportedAt) + 30 * 24 * 60 * 60 * 1000 + 1)
        .filter((time) => Number.isFinite(time) && time > current);
      timer = setTimeout(tick, Math.min(current + 60_000 - current % 60_000, ...expiries) - current);
    };
    const resume = () => { clearTimeout(timer); tick(); };
    tick();
    document.addEventListener("visibilitychange", resume);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", resume); };
  }, [deals, status]);
  async function reportDeal(id: string) {
    if (report?.state === "sending") return;
    setReport({ id, state: "sending" });
    try {
      const response = await fetch("/api/deal-prices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "report", id }) });
      if (!response.ok) throw new Error("Report failed");
      setReport({ id, state: "sent" });
    } catch { setReport({ id, state: "failed" }); }
  }
  if (experienceLens === "food") return null;
  if (status === "loading") return <p role="status">Checking deals…</p>;
  if (status === "unavailable") return <p>Deal information is unavailable right now.</p>;
  const visibleDeals = deals.filter((deal) => experienceLens === "no-alcohol"
    ? NO_ALCOHOL_DRINK_CATEGORIES.includes(deal.drinkCategory)
    : !drinkLensCategory || deal.drinkCategory === drinkLensCategory);
  if (!visibleDeals.length) return null;
  return <section className="dealPriceList" aria-label="Reported deals">
    <h3>Reported deals</h3>
    {visibleDeals.map((deal) => <div key={deal.id}>
      <strong>{formatGbp(deal.priceGbp)} · {deal.drink} · {drinkMeasureName(deal.measure, deal.measureLabel)}</strong>
      {dealAvailableNow(deal, new Date(now)) ? <span> · On now</span> : null}
      <div>{deal.schedule.days.map((day) => DAYS[day]).join(", ")} · {deal.schedule.start} to {deal.schedule.end}{deal.schedule.end < deal.schedule.start ? " next day" : ""}{deal.endDate ? ` · ends ${deal.endDate}` : ""}</div>
      {deal.conditions ? <div>{deal.conditions}</div> : null}
      <div>Reported {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }).format(new Date(deal.reportedAt))}. Check with the pub.</div>
      {report?.id === deal.id && report.state === "sent" ? <p role="status">Thanks. We will review this deal.</p> : <Button type="button" variant="ghost" aria-label={`Report deal for ${deal.drink}`} disabled={report?.state === "sending"} onClick={() => { void reportDeal(deal.id); }}>Report this deal</Button>}
      {report?.id === deal.id && report.state === "failed" ? <p role="alert">Could not send the report. Try again.</p> : null}
    </div>)}
  </section>;
}
