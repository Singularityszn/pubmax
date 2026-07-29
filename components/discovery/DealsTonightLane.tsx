"use client";

// W3 - Deals vertical UI. Consumes /api/whats-on?kind=deal so
// Discover surfaces the 384-row deals spine instead of leaving it invisible.

import Link from "next/link";
import { useEffect, useState } from "react";
import { PoundSterling } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import { isValidWhatsOnRow, type WhatsOnRow } from "@/lib/whatsOn";
import { checkedLabel, WHATS_ON_KIND_META } from "@/lib/whatsOnBadges";
import { preferredCityMapHref } from "@/lib/cityPreference";
import { WhatsOnUrgencyBadge } from "@/components/map/WhatsOnUrgencyBadge";

import "./dealsTonightLane.css";

type DealsState = { rows: WhatsOnRow[]; asOf: string | null };

export type DealsTonightLaneProps = {
  /** When provided, render from these already-loaded rows (deal families are
   *  filtered out here) and skip the self-fetch, so a host that already loaded the
   *  spine (Tonight) never fires a duplicate request. Omitted on Discover, which
   *  self-fetches exactly as before. */
  rows?: WhatsOnRow[];
  asOf?: string | null;
};

export default function DealsTonightLane({ rows: providedRows, asOf: providedAsOf }: DealsTonightLaneProps = {}) {
  const provided = providedRows !== undefined;
  const [state, setState] = useState<DealsState>({ rows: [], asOf: null });

  useEffect(() => {
    if (provided) return; // reuse mode: the host already loaded the spine.
    const controller = new AbortController();
    fetch("/api/whats-on?kind=deal&window=tonight&limit=8", {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body || !Array.isArray(body.rows)) return;
        const rows = body.rows.filter(isValidWhatsOnRow).slice(0, 8);
        setState({
          rows,
          asOf: typeof body.asOf === "string" ? body.asOf : null,
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [provided]);

  const rows = provided
    ? providedRows.filter((row) => row.kind === "deal").slice(0, 8)
    : state.rows;
  const asOf = provided ? (providedAsOf ?? null) : state.asOf;

  if (rows.length === 0) return null;

  const meta = WHATS_ON_KIND_META.deal;

  return (
    <section className="dealsTonight" aria-labelledby="deals-tonight-title">
      <div className="dealsTonightHead">
        <h2 id="deals-tonight-title">
          <PoundSterling size={18} aria-hidden="true" /> Deals tonight
        </h2>
        <span className="dealsTonightChecked">{checkedLabel(asOf)}</span>
      </div>
      <p className="dealsTonightLead">
        Listed offers and experience deals, {meta.badgeLabel.toLowerCase()}.
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
