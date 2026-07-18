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
  Beer,
  CalendarClock,
  ChevronDown,
  ExternalLink,
  Footprints,
  LocateFixed,
  MapPin,
  RefreshCw,
  Route as RouteIcon,
  TrainFront,
  Tv,
  X,
} from "lucide-react";

import SiteNav from "@/components/nav/SiteNav";
import { useWhatsOnTonight } from "@/components/map/useWhatsOnTonight";
import TonightConditionsStrip from "./TonightConditionsStrip";
import TonightGetHomeStrip from "./TonightGetHomeStrip";
import AreaNewsRail from "@/components/desktop/AreaNewsRail";
import { nearestNightAreaForViewport } from "@/lib/nightAreas";
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

// A thin night (0-2 confirmed listings) leaves the list short enough that the
// page dies into empty gradient below it. Rather than invent listings (never
// — "thin nights stay thin" is honest), fill the rest of the page with the
// three things someone standing here actually still wants: where's cheap,
// how do I get home, and what else is there to do tonight.
const THIN_NIGHT_MAX_ROWS = 2;

type QuietAlternative = {
  href: string;
  icon: typeof Beer;
  title: string;
  sub: string;
};

const QUIET_ALTERNATIVES: QuietAlternative[] = [
  {
    href: "/map",
    icon: Beer,
    title: "Cheapest pints near you",
    sub: "Every venue on the map, priced",
  },
  {
    href: "/map",
    icon: TrainFront,
    title: "Check your last train home",
    sub: "Open a pub's Getting Home tab on the map",
  },
  {
    href: "/crawls",
    icon: RouteIcon,
    title: "Browse crawls",
    sub: "Multi-stop routes worth planning around",
  },
];

export default function TonightClient() {
  const { rows, asOf, status, retry } = useWhatsOnTonight(true);
  const [activeKind, setActiveKind] = useState<WhatsOnKind | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  // The location card is a quiet, collapsed row until tapped — it must not be
  // the first thing on the page. Once a position is shared it stays open so the
  // last-train strip has somewhere to live.
  const [locationOpen, setLocationOpen] = useState(false);

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
  // Unfiltered `rows.length`, not the kind-filtered `visible.length` — a thin
  // night stays thin regardless of which chip is active, and this must not
  // flicker in/out as the user taps filters.
  const thinNight = empty || (ready && rows.length <= THIN_NIGHT_MAX_ROWS);
  const hasGeoRows =
    ready &&
    rows.some(
      (row) => typeof row.lat === "number" && typeof row.lng === "number",
    );
  const showLocation = hasGeoRows || thinNight;
  const locationExpanded = locationOpen || origin != null;

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
          Quiz, sport, deals, and live music from sourced listings. The same
          spine as the map.
        </p>
        {ready || empty ? (
          <p className="tonightProvenance">
            {coverageLabel(rows.length)}
            <span aria-hidden="true"> · </span>
            {checkedLabel(asOf)} · via what&rsquo;s-on
          </p>
        ) : null}
      </header>

      <TonightConditionsStrip origin={origin} />
      {/* Wide viewports place the strip plus this block in a sticky right rail
          (tonight.css grid); below the breakpoint the rail block simply follows
          the strip in flow. Area news needs a coarse area: derived from the
          shared location's nearest Night Area, never stored. */}
      <div className="tonightRail">
        <AreaNewsRail
          area={
            origin
              ? (nearestNightAreaForViewport("london", [origin.lng, origin.lat])
                  ?.slug ?? null)
              : null
          }
        />
      </div>

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
          Nothing confirmed in London tonight yet. We only show what the
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

      {thinNight ? (
        <section className="tonightQuiet" aria-label="While it's quiet">
          <p className="tonightQuietLede">
            Quiet one tonight. Still worth a look:
          </p>
          <ul className="tonightQuietList">
            {QUIET_ALTERNATIVES.map((alt) => {
              const Icon = alt.icon;
              return (
                <li key={alt.title} className="tonightQuietRow">
                  <Link href={alt.href} className="tonightQuietLink pressable">
                    <span className="tonightQuietIcon" aria-hidden="true">
                      <Icon size={17} />
                    </span>
                    <span className="tonightQuietBody">
                      <span className="tonightQuietTitle">{alt.title}</span>
                      <span className="tonightQuietSub">{alt.sub}</span>
                    </span>
                    <ArrowUpRight size={15} aria-hidden="true" className="tonightQuietArrow" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {showLocation ? (
        <section
          className="tonightLocation"
          aria-label="Location for walk times and last train"
        >
          <button
            type="button"
            className="tonightLocationToggle pressable"
            aria-expanded={locationExpanded}
            onClick={() => setLocationOpen((open) => !open)}
          >
            <LocateFixed size={15} aria-hidden="true" />
            <span className="tonightLocationToggleLabel">
              Walk times and last train
            </span>
            <ChevronDown
              size={16}
              aria-hidden="true"
              className="tonightLocationChevron"
              data-open={locationExpanded}
            />
          </button>
          {locationExpanded ? (
            <div className="tonightLocationBody">
              <p className="tonightLocationCopy">
                Sharing location is optional. Walk times stay on this page; your
                rough position (nearest 100m or so) is used once to check your
                nearest station and last train, and is never saved.
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
                      : "Share location for walk times and last train"}
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
              {origin ? <TonightGetHomeStrip origin={origin} /> : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
