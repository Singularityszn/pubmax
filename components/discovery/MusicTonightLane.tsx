"use client";

// W4 Music vertical UI. Consumes /api/whats-on?kind=music with honest
// thin-coverage copy when the spine is sparse (CityMCP + chain listings).

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Music2 } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import { isValidWhatsOnRow, type WhatsOnRow } from "@/lib/whatsOn";
import { checkedLabel, WHATS_ON_KIND_META } from "@/lib/whatsOnBadges";
import { preferredCityMapHref } from "@/lib/cityPreference";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

import "./dealsTonightLane.css";

type MusicState = { rows: WhatsOnRow[] };

export type MusicTonightLaneProps = {
  /** When provided, render from these already-loaded rows (music families are
   *  filtered out here) and skip the self-fetch, so a host that already loaded the
   *  spine (Tonight) never fires a duplicate request. Omitted on Discover. */
  rows?: WhatsOnRow[];
  /** Compatibility input. The rendered cards own their observation dates. */
  asOf?: string | null;
};

/** Below this count we label coverage as thin rather than implying a full guide. */
const THIN_COVERAGE_MAX = 4;

export default function MusicTonightLane({ rows: providedRows }: MusicTonightLaneProps = {}) {
  const provided = providedRows !== undefined;
  const [state, setState] = useState<MusicState>({ rows: [] });

  useEffect(() => {
    if (provided) return; // reuse mode: the host already loaded the spine.
    const controller = new AbortController();
    void loadSurfaceJson<{
      rows?: unknown;
      asOf?: unknown;
      kindObservedAt?: unknown;
    }>(
      "/api/whats-on?kind=music&window=tonight&limit=8",
      {
        signal: controller.signal,
        validate: (body) => Array.isArray(body?.rows),
      },
      (body) => {
        const rows = (Array.isArray(body.rows) ? body.rows : [])
          .filter(isValidWhatsOnRow)
          .slice(0, 8);
        setState({ rows });
      },
    );
    return () => controller.abort();
  }, [provided]);

  const rows = provided
    ? providedRows.filter((row) => row.kind === "music").slice(0, 8)
    : state.rows;
  // A merged lane can contain Out rows that the music feed never observed.
  // Date the cards themselves, using the oldest check that covers every row.
  const checks = rows.map((row) => Date.parse(row.observedAt));
  const asOf = checks.length > 0 && checks.every(Number.isFinite)
    ? new Date(Math.min(...checks)).toISOString()
    : null;

  if (rows.length === 0) return null;

  const meta = WHATS_ON_KIND_META.music;
  const thin = rows.length <= THIN_COVERAGE_MAX;

  return (
    <section className="dealsTonight" aria-labelledby="music-tonight-title" data-coverage={thin ? "thin" : "ok"}>
      <div className="dealsTonightHead">
        <h2 id="music-tonight-title">
          <Music2 size={18} aria-hidden="true" />
          <span>Live music tonight</span>
        </h2>
        <span className="dealsTonightChecked">{checkedLabel(asOf)}</span>
      </div>
      <p className="dealsTonightLead">
        {thin
          ? `Thin coverage tonight: ${rows.length} sourced listing${rows.length === 1 ? "" : "s"} only. Not a full gig guide.`
          : `${meta.badgeLabel} from sourced listings. Times and line-ups vary; check the source.`}
      </p>
      <ul className="dealsTonightList">
        {rows.map((row) => {
          const mapHref: Route = row.venueId
            ? `/map?sel=${encodeURIComponent(row.venueId)}`
            : preferredCityMapHref();
          return (
            <li key={row.id}>
              <Link prefetch={false}
                href={mapHref}
                className="dealsTonightCard"
                onClick={() => trackEvent("lane_card_tap")}
              >
                <strong>{row.title}</strong>
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
      <Link prefetch={false}
        className="dealsTonightMap"
        href="/map?src=whats-on-music"
        onClick={() => trackEvent("whats_on_filter")}
      >
        Open live music on the map
      </Link>
    </section>
  );
}
