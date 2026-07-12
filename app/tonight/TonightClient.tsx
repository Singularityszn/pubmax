"use client";

// First-class "Tonight" screen (Wave A · A2). A full-page, scannable answer to
// "what's on near me tonight" so the viewer never has to hunt the map:
//   - one fetch of the CityMCP London `things_to_do` tonight window (the same
//     grounded live layer the Discover "Tonight nearby" lane already uses),
//   - kind filter chips derived from the kinds actually present (not a fixed
//     taxonomy), and
//   - one row per opportunity: title, venue + area, when, price when known,
//     an optional "~N min walk" estimate once the viewer shares their location,
//     and a tap target into the map (or the upstream source).
//
// Honest by construction: unknown ≠ invented (missing fields are omitted, thin
// nights are labelled thin), a fetch failure lands an explicit error state
// rather than a blank screen, and provenance ("Checked <date> · via CityMCP
// London") rides the header. Walk time is a straight-line haversine estimate
// (see lib/tonight.walkMinutes) — deterministic and clearly labelled "~".
//
// React 19 safe: every state write is deferred with Promise.resolve().then so
// nothing fires setState synchronously inside an effect body, and an
// AbortController cancels the in-flight fetch on unmount.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ExternalLink, Footprints, MapPin } from "lucide-react";

import SiteNav from "@/components/nav/SiteNav";
import TonightShareButton from "./TonightShareButton";
import { trackEvent } from "@/lib/analytics";
import { firstHttp } from "@/lib/httpUrl";
import {
  coverageLabel,
  deriveKindFacets,
  filterByKind,
  labelForKind,
  opportunityMapHref,
  provenanceLabel,
  walkLabel,
  walkMinutes,
  type TonightOpportunity,
} from "@/lib/tonight";

import "./tonight.css";

type ApiResponse = {
  window?: string;
  area?: string | null;
  asOf?: string | null;
  opportunities?: TonightOpportunity[];
  error?: string;
};

type LoadState = "loading" | "ready" | "empty" | "error";

type Origin = { lat: number; lng: number };

function opportunityLink(
  op: TonightOpportunity,
): { href: string; external: boolean } | null {
  const mapHref = opportunityMapHref(op);
  if (mapHref) return { href: mapHref, external: false };
  const url = firstHttp(op.source?.url);
  if (url) return { href: url, external: true };
  return null;
}

export default function TonightClient() {
  const [ops, setOps] = useState<TonightOpportunity[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);

  // Load tonight's opportunities.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          "/api/citymcp/things-to-do?window=tonight&limit=20",
          { signal: controller.signal, headers: { accept: "application/json" } },
        );
        if (!res.ok) {
          settle(() => setState("error"), controller);
          return;
        }
        const body = (await res.json()) as ApiResponse;
        const list = Array.isArray(body.opportunities)
          ? body.opportunities.filter(
              (o) => o && typeof o.title === "string" && o.title.length > 0,
            )
          : [];
        settle(() => {
          setAsOf(body.asOf ?? null);
          setOps(list);
          setState(list.length === 0 ? "empty" : "ready");
        }, controller);
      } catch {
        settle(() => setState("error"), controller);
      }
    })();
    return () => controller.abort();
  }, []);

  // D0: the headline Wave A metric — the screen was opened. Fired once on
  // mount, independent of whether the upstream had anything tonight.
  useEffect(() => {
    trackEvent("tonight_screen_view");
  }, []);

  // Progressive enhancement: once (and only if) the viewer shares their
  // location, walk-time estimates fill in. Never blocks the list; a denial or
  // missing API simply leaves walk time off.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const { latitude, longitude } = pos.coords;
        void Promise.resolve().then(() => {
          if (!cancelled) setOrigin({ lat: latitude, lng: longitude });
        });
      },
      () => {
        /* denied / unavailable — walk time stays hidden */
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 8_000 },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const facets = useMemo(() => deriveKindFacets(ops), [ops]);
  const visible = useMemo(
    () => filterByKind(ops, activeKind),
    [ops, activeKind],
  );

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
          A grounded read of London tonight — via CityMCP London. No invented
          listings; thin nights are labelled thin.
        </p>
        {state === "ready" || state === "empty" ? (
          <p className="tonightProvenance">
            {coverageLabel(ops.length)}
            <span aria-hidden="true"> · </span>
            {provenanceLabel(asOf)} · via CityMCP London
          </p>
        ) : null}
      </header>

      {state === "loading" ? (
        <p className="tonightStatus" role="status">
          Reading tonight&rsquo;s listings…
        </p>
      ) : null}

      {state === "error" ? (
        <p className="tonightStatus tonightStatusError" role="status">
          Couldn&rsquo;t reach tonight&rsquo;s listings just now. Try again
          shortly.
        </p>
      ) : null}

      {state === "empty" ? (
        <p className="tonightStatus" role="status">
          Nothing confirmed in London tonight yet — we only show what the
          upstream actually returns. Check back later.
        </p>
      ) : null}

      {state === "ready" ? (
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
                <span className="tonightChipCount">{ops.length}</span>
              </button>
              {facets.map((facet) => (
                <button
                  key={facet.kind}
                  type="button"
                  className="tonightChip"
                  data-active={activeKind === facet.kind}
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
            {visible.map((op, idx) => {
              const link = opportunityLink(op);
              const kindLabel = labelForKind(op.kind);
              const area = op.place?.area ?? op.areas?.[0];
              const when = op.timeEvidence ?? op.availability;
              const loc = op.place?.location;
              const walk = walkLabel(walkMinutes(origin, loc));
              const RowInner = (
                <>
                  <div className="tonightRowMeta">
                    {kindLabel ? (
                      <span className="tonightRowKind">{kindLabel}</span>
                    ) : null}
                    {op.price ? (
                      <span className="tonightRowPrice">{op.price}</span>
                    ) : null}
                  </div>
                  <h2 className="tonightRowTitle">{op.title}</h2>
                  {op.place?.name || area ? (
                    <p className="tonightRowPlace">
                      <MapPin size={13} aria-hidden="true" />
                      <span>
                        {op.place?.name ?? ""}
                        {op.place?.name && area ? " · " : ""}
                        {area ?? ""}
                      </span>
                    </p>
                  ) : null}
                  <div className="tonightRowFacts">
                    {when ? <span className="tonightRowWhen">{when}</span> : null}
                    {walk ? (
                      <span className="tonightRowWalk">
                        <Footprints size={12} aria-hidden="true" />
                        {walk}
                      </span>
                    ) : null}
                  </div>
                  {link ? (
                    <span className="tonightRowCta">
                      {link.external ? (
                        <>
                          {op.source?.label ?? "Details"}
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
                  key={`${op.title}-${idx}`}
                  className="tonightRow"
                  data-kind={op.kind ?? "other"}
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
              No {labelForKind(activeKind ?? "") ?? "matching"} listings tonight.{" "}
              <button
                type="button"
                className="tonightInlineReset"
                onClick={() => setActiveKind(null)}
              >
                Show all
              </button>
            </p>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

/** Defer a state write out of the effect body and skip it if unmounted. */
function settle(fn: () => void, controller: AbortController): void {
  void Promise.resolve().then(() => {
    if (!controller.signal.aborted) fn();
  });
}
