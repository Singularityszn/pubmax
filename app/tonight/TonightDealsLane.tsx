"use client";

import Link from "next/link";
import { PoundSterling } from "lucide-react";

import { WhatsOnUrgencyBadge } from "@/components/map/WhatsOnUrgencyBadge";
import { trackEvent } from "@/lib/analytics";
import { preferredCityMapHref } from "@/lib/cityPreference";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { WHATS_ON_KIND_META } from "@/lib/whatsOnBadges";

export function tonightDealsCountLabel(rows: readonly WhatsOnRow[]): string {
  const count = rows.filter((row) => row.kind === "deal").slice(0, 8).length;
  return `${count} listed deal${count === 1 ? "" : "s"}`;
}

export default function TonightDealsLane({ rows: providedRows }: { rows: WhatsOnRow[] }) {
  const rows = providedRows.filter((row) => row.kind === "deal").slice(0, 8);
  if (rows.length === 0) return null;

  const meta = WHATS_ON_KIND_META.deal;

  return (
    <section className="dealsTonight" aria-labelledby="tonight-deals-title">
      <div className="dealsTonightHead">
        <h2 id="tonight-deals-title">
          <PoundSterling size={18} aria-hidden="true" /> Deals tonight
        </h2>
        <span className="dealsTonightChecked">{tonightDealsCountLabel(rows)}</span>
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
