"use client";

// First-class "Tonight" screen — PRIMARY What's-On spine (/api/whats-on),
// same source as the map Tonight lane (W1). CityMCP things-to-do stays a
// secondary Discover overlay; this page must never disagree with the lane.
//
// Kind chips, provenance, and map deep-links mirror the lane. Walk time is a
// straight-line haversine estimate once the viewer shares location (labelled "~").
// React 19 safe: settle() defers setState out of the effect body.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  CalendarClock,
  ExternalLink,
  Footprints,
  LocateFixed,
  MapPin,
  RefreshCw,
  Tv,
  X,
} from "lucide-react";

import SiteNav from "@/components/nav/SiteNav";
import { useWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
import TonightShareButton from "./TonightShareButton";
import { trackEvent } from "@/lib/analytics";
import { firstHttp } from "@/lib/httpUrl";
import { walkLabel, walkMinutes } from "@/lib/tonight";
import type { WhatsOnKind, WhatsOnRow } from "@/lib/whatsOn";
import {
  checkedLabel,
  filterLaneRows,
  laneKindFacets,
  laneTimeLabel,
  WHATS_ON_KIND_META,
} from "@/lib/whatsOnBadges";

import "./tonight.css";

type Origin = { lat: number; lng: number };
type LocationStatus = "idle" | "requesting" | "unavailable";

function rowHref(row: WhatsOnRow): { href: string; external: boolean } | null {
  if (typeof row.venueId === "string" && row.venueId.length > 0) {
    return { href: `/map?sel=${encodeURIComponent(row.venueId)}`, external: false };
  }
  const url = firstHttp(row.source?.url);
  if (url) return { href: url, external: true };
  return null;
}

function coverageLabel(count: number): string {
  if (count === 0) return "Quiet night";
  if (count === 1) return "1 listing tonight";
  return `${count} listings tonight`;
}

export default function TonightClient() {
  const { rows, asOf, status, retry } = useWhatsOnTonight(true);
  const [activeKind, setActiveKind] = useState<WhatsOnKind | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");

  useEffect(() => {
    trackEvent("tonight_screen_view");
  }, []);

  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationStatus("unavailable");
      return;
    }
    setLocationStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setOrigin({ lat: latitude, lng: longitude });
        setLocationStatus("idle");
      },
      () => setLocationStatus("unavailable"),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 8_000 },
    );
  }, []);

  const clearLocation = useCallback(() => {
    setOrigin(null);
    setLocationStatus("idle");
  }, []);

  const facets = useMemo(() => laneKindFacets(rows), [rows]);
  const visible = useMemo(
    () => filterLaneRows(rows, activeKind),
    [rows, activeKind],
  );

  const ready = status === "ready";
  const empty = status === "empty";
  const errored = status === "error";
  const loading = status === "idle";

  return (
    <main className="tonightPage" data-testid="tonight-screen">
      <SiteNav active="tonight" />

      <header className="tonightHead">
        <div className="tonightEyebrowRow">
          <p className="tonightEyebrow">Tonight in London</p>
          <TonightShareButton />
        </div>
        <h1 className="tonightTitle">What&rsquo;s on near you, right now.</h1>
        <p className="tonightLede">
          Quiz, sport, deals, and live music from sourced listings — the same
          spine as the map. No invented nights; thin nights stay thin.
        </p>
        {ready || empty ? (
          <p className="tonightProvenance">
            {coverageLabel(rows.length)}
            <span aria-hidden="true"> · </span>
            {checkedLabel(asOf)} · via what&rsquo;s-on
          </p>
        ) : null}
        {ready && rows.some((row) => typeof row.lat === "number" && typeof row.lng === "number") ? (
          <div className="tonightLocation">
            <p className="tonightLocationCopy">
              Walk times are optional. Your location stays on this page and is not
              sent or saved.
            </p>
            {origin ? (
              <button
                type="button"
                className="tonightLocationButton"
                onClick={clearLocation}
              >
                <X size={15} aria-hidden="true" />
                Remove location
              </button>
            ) : (
              <button
                type="button"
                className="tonightLocationButton"
                onClick={requestLocation}
                disabled={locationStatus === "requesting"}
              >
                <LocateFixed size={15} aria-hidden="true" />
                {locationStatus === "requesting"
                  ? "Finding your location…"
                  : locationStatus === "unavailable"
                    ? "Try location again"
                    : "Share location for walk times"}
              </button>
            )}
            <span className="tonightSrOnly" role="status" aria-live="polite">
              {locationStatus === "requesting"
                ? "Finding your location."
                : locationStatus === "unavailable"
                  ? "Location unavailable. You can try again."
                  : origin
                    ? "Walk times are now shown."
                    : ""}
            </span>
          </div>
        ) : null}
      </header>

      {loading ? (
        <p className="tonightStatus" role="status">
          Reading tonight&rsquo;s listings…
        </p>
      ) : null}

      {errored ? (
        <div className="tonightStatus tonightStatusError">
          <p role="status">Couldn&rsquo;t reach tonight&rsquo;s listings just now.</p>
          <button type="button" className="tonightRetry" onClick={retry}>
            <RefreshCw size={15} aria-hidden="true" />
            Retry listings
          </button>
        </div>
      ) : null}

      {empty ? (
        <p className="tonightStatus" role="status">
          Nothing confirmed in London tonight yet — we only show what the
          upstream actually returns. Check back later.
        </p>
      ) : null}

      {ready ? (
        <>
          {facets.length > 1 ? (
            <div
              className="tonightFilters"
              role="group"
              aria-label="Filter tonight by kind"
            >
              <button
                type="button"
                className="tonightChip"
                data-active={activeKind === null}
                aria-pressed={activeKind === null}
                onClick={() => setActiveKind(null)}
              >
                All
                <span className="tonightChipCount">{rows.length}</span>
              </button>
              {facets.map((facet) => (
                <button
                  key={facet.kind}
                  type="button"
                  className="tonightChip"
                  data-active={activeKind === facet.kind}
                  data-kind={facet.kind}
                  aria-pressed={activeKind === facet.kind}
                  onClick={() => {
                    setActiveKind(facet.kind);
                    trackEvent("tonight_filter_select", { kind: facet.kind });
                  }}
                >
                  {facet.label}
                  <span className="tonightChipCount">{facet.count}</span>
                </button>
              ))}
            </div>
          ) : null}

          <ul className="tonightList" data-testid="tonight-list">
            {visible.map((row) => {
              const link = rowHref(row);
              const meta = WHATS_ON_KIND_META[row.kind];
              const when = laneTimeLabel(row) ?? meta.badgeLabel;
              const walk =
                typeof row.lat === "number" && typeof row.lng === "number"
                  ? walkLabel(walkMinutes(origin, { lat: row.lat, lng: row.lng }))
                  : null;
              const KindIcon = row.kind === "sport" ? Tv : CalendarClock;
              const RowInner = (
                <>
                  <div className="tonightRowMeta">
                    <span className="tonightRowKind" data-kind={row.kind}>
                      <KindIcon size={12} aria-hidden="true" />
                      {meta.label}
                    </span>
                    {typeof row.priceGbp === "number" ? (
                      <span className="tonightRowPrice">
                        £{row.priceGbp.toFixed(2)}
                      </span>
                    ) : null}
                  </div>
                  <h2 className="tonightRowTitle">{row.title}</h2>
                  <p className="tonightRowPlace">
                    <MapPin size={13} aria-hidden="true" />
                    <span>{row.placeName}</span>
                  </p>
                  <div className="tonightRowFacts">
                    {when ? <span className="tonightRowWhen">{when}</span> : null}
                    {walk ? (
                      <span className="tonightRowWalk">
                        <Footprints size={12} aria-hidden="true" />
                        {walk}
                      </span>
                    ) : null}
                    <span className="tonightRowSource">via {row.source.label}</span>
                  </div>
                  {link ? (
                    <span className="tonightRowCta">
                      {link.external ? (
                        <>
                          {row.source.label}
                          <ExternalLink size={13} aria-hidden="true" />
                        </>
                      ) : (
                        <>
                          Open on map
                          <ArrowUpRight size={13} aria-hidden="true" />
                        </>
                      )}
                    </span>
                  ) : null}
                </>
              );
              return (
                <li
                  key={row.id}
                  className="tonightRow"
                  data-kind={row.kind}
                  data-testid="tonight-row"
                >
                  {link ? (
                    link.external ? (
                      <a
                        className="tonightRowLink pressable"
                        href={link.href}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {RowInner}
                      </a>
                    ) : (
                      <Link className="tonightRowLink pressable" href={link.href}>
                        {RowInner}
                      </Link>
                    )
                  ) : (
                    <div className="tonightRowLink">{RowInner}</div>
                  )}
                </li>
              );
            })}
          </ul>

          {visible.length === 0 ? (
            <p className="tonightStatus" role="status">
              No {activeKind ? WHATS_ON_KIND_META[activeKind].label.toLowerCase() : "matching"}{" "}
              listings tonight.{" "}
              <button
                type="button"
                className="tonightInlineReset"
                onClick={() => setActiveKind(null)}
              >
                Show all
              </button>
            </p>
          ) : null}

          <p className="tonightFoot">
            <Link href="/map" className="tonightFootLink">
              See them on the map
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </p>
        </>
      ) : null}
    </main>
  );
}
