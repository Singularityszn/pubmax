"use client";

import { useEffect, useState } from "react";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import type { BoroughSummary } from "@/lib/boroughs";
import ListedPriceSource from "@/components/venue/ListedPriceSource";

type CityAreaResponse = {
  borough: string | null;
  averagePintGbp: number | null;
  asOf: string | null;
  error?: string;
};

type BoroughPintPriceCardProps = {
  boroughName: string;
  ourCheapestPint: BoroughSummary["cheapestPint"];
};

function checkedDate(iso: string | null): { day: string; label: string } | null {
  if (typeof iso !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(iso);
  if (!match) return null;
  const calendar = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== match[1]) return null;
  if (iso === match[1]) return { day: match[1], label: formatObservedDate(new Date(`${match[1]}T12:00:00Z`)) };
  if (!/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso)) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  return { day: new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/London" }).format(date), label: formatObservedDate(date) };
}

/**
 * CityMCP-sourced average pint price for the borough — a small provenance-
 * labelled chip on the borough page's header. Client-fetched (CityMCP is a
 * live upstream, not baked into the static dataset build at build time) and
 * fail-soft: a missing/errored response just renders nothing, never a
 * broken chip. Always labelled "CityMCP" — never presented as our own
 * community data, since it isn't.
 */
export default function BoroughPintPriceCard({
  boroughName,
  ourCheapestPint,
}: BoroughPintPriceCardProps) {
  const [area, setArea] = useState<CityAreaResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const qs = new URLSearchParams({ borough: boroughName });
    void loadSurfaceJson<CityAreaResponse>(
      `/api/citymcp/area?${qs.toString()}`,
      {
        signal: controller.signal,
        validate: (body) =>
          Boolean(
            body &&
              typeof body === "object" &&
              "averagePintGbp" in body &&
              "borough" in body,
          ),
      },
      (body) => setArea(body),
    );
    return () => controller.abort();
  }, [boroughName]);

  if (!area || typeof area.averagePintGbp !== "number") return null;

  const checked = checkedDate(area.asOf);
  const comparison = ourCheapestPint && ourCheapestPint.evidence.priceGbp < area.averagePintGbp ? ourCheapestPint : null;

  return (
    <div className="boroughPintChip" role="status">
      <p className="boroughPintChipAverage">
        <span className="boroughPintChipLabel">CityMCP</span>
        <span>Average pint in {boroughName}: £{area.averagePintGbp.toFixed(2)} · {checked ? <>checked <time dateTime={checked.day}>{checked.label}</time></> : "Read date unavailable"}</span>
      </p>
      {comparison ? (
        <div className="boroughPintChipCompare boroughPriceEvidence">
          <p>Our map&rsquo;s cheapest here is £{comparison.evidence.priceGbp.toFixed(2)} at {comparison.venueName}.</p>
          <p>{comparison.evidence.drinkLabel || "Drink not recorded"} · {comparison.evidence.servingSize || "Serving not recorded"}</p>
          <ListedPriceSource evidence={comparison.evidence} kind={comparison.evidence.sourceKind} />
        </div>
      ) : null}
    </div>
  );
}
