"use client";

// W3 - Deals vertical UI. Consumes /api/whats-on?kind=deal so
// Discover surfaces the 384-row deals spine instead of leaving it invisible.

import Link from "next/link";
import { useEffect, useState } from "react";
import { PoundSterling } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import { isValidWhatsOnRow, type WhatsOnRow } from "@/lib/whatsOn";
import { WHATS_ON_KIND_META } from "@/lib/whatsOnBadges";
import { preferredCityMapHref } from "@/lib/cityPreference";
import { WhatsOnUrgencyBadge } from "@/components/map/WhatsOnUrgencyBadge";

import "./dealsTonightLane.css";

export type DealsTonightLaneProps = {
  /** When provided, render from these already-loaded rows (deal families are
   *  filtered out here) and skip the self-fetch, so a host that already loaded the
   *  spine (Tonight) never fires a duplicate request. Omitted on Discover, which
   *  self-fetches exactly as before. */
  rows?: WhatsOnRow[];
};

function selectDealsTonightRows(value: unknown): WhatsOnRow[] {
  return Array.isArray(value)
    ? value.filter((row) => isValidWhatsOnRow(row)).filter((row) => row.kind === "deal").slice(0, 8)
    : [];
}

export function dealsTonightRowsFromResponse(body: unknown): WhatsOnRow[] {
  if (typeof body !== "object" || body === null) return [];
  return selectDealsTonightRows((body as { rows?: unknown }).rows);
}

export default function DealsTonightLane({ rows: providedRows }: DealsTonightLaneProps = {}) {
  const provided = providedRows !== undefined;
  const [fetchedRows, setFetchedRows] = useState<WhatsOnRow[]>([]);

  useEffect(() => {
    if (provided) return; // reuse mode: the host already loaded the spine.
    const controller = new AbortController();
    fetch("/api/whats-on?kind=deal&window=tonight&limit=8", {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        setFetchedRows(dealsTonightRowsFromResponse(body));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [provided]);

  const rows = provided
    ? selectDealsTonightRows(providedRows)
    : fetchedRows;

  if (rows.length === 0) return null;

  const meta = WHATS_ON_KIND_META.deal;

  return (
    <section className="dealsTonight" aria-labelledby="deals-tonight-title">
      <div className="dealsTonightHead">
        <h2 id="deals-tonight-title">
          <PoundSterling size={18} aria-hidden="true" /> Deals tonight
        </h2>
        <span className="dealsTonightChecked">
          {rows.length} listed deal{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="dealsTonightLead">
        Listed offers and other deals, {meta.badgeLabel.toLowerCase()}.
        Prices and inclusions vary; check the source.
      </p>
      <ul className="dealsTonightList">
        {rows.map((row) => {
          const mapHref = row.venueId
            ? `/map?sel=${encodeURIComponent(row.venueId)}`
            : preferredCityMapHref();
          return (
            <li key={row.id}>
              <Link
                href={mapHref}
                className="dealsTonightCard"
                onClick={() => trackEvent("lane_card_tap")}
              >
                <div className="dealsTonightCardHead">
                  <strong>{row.title}</strong>
                  <WhatsOnUrgencyBadge row={row} />
                </div>
                <span className="dealsTonightPlace">{row.placeName}</span>
                {row.detail ? <span className="dealsTonightDetail">{row.detail}</span> : null}
                <span className="dealsTonightSource">
                  {row.source.label}
                  {row.source.url ? " · sourced" : ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        className="dealsTonightMap"
        href="/map?src=whats-on-deal"
        onClick={() => trackEvent("whats_on_filter")}
      >
        Open deals on the map
      </Link>
    </section>
  );
}
