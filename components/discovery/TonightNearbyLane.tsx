"use client";

// Discover "Tonight nearby" lane — CityMCP London `things_to_do` for the
// tonight window, rendered as a scannable card row alongside the cheapest
// pints and editorial lanes. London-primary: the section is authored around
// London and only surfaces when the upstream returns opportunities.
//
// Card links:
//   - opportunities with a `place.id` + coordinates → deep-link to the map
//     for London (cityAwareMapPath), so tapping "tonight" lands the viewer on
//     the pin next to the venue.
//   - fallback: the source URL (external), when the upstream attached one.
//   - otherwise, no CTA (we don't fabricate links).
//
// Fail-soft + React 19 safe: any fetch failure hides the lane, and all state
// writes are deferred with Promise.resolve().then so no setState fires
// synchronously in an effect body. Uses AbortController to cancel in-flight
// requests on unmount.

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, ExternalLink, MapPin } from "lucide-react";

import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";
import { firstHttp } from "@/lib/httpUrl";
import { labelForKind, opportunityMapHref } from "@/lib/thingsToDoMap";

import "./tonightNearbyLane.css";

type Opportunity = ThingsToDoOpportunity;

type ApiResponse = {
  window?: string;
  area?: string | null;
  asOf?: string | null;
  opportunities?: Opportunity[];
  error?: string;
};

function opportunityHref(op: Opportunity): { href: string; external: boolean } | null {
  // Prefer map deep-link when we have a place id (Discover CTA contract) + coords.
  if (op.place?.id) {
    const mapHref = opportunityMapHref(op);
    if (mapHref) return { href: mapHref, external: false };
  }
  const url = firstHttp(op.source?.url);
  if (url) return { href: url, external: true };
  return null;
}

export default function TonightNearbyLane() {
  const [ops, setOps] = useState<Opportunity[]>([]);
  const [status, setStatus] = useState<"idle" | "ready" | "hidden">("idle");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          "/api/citymcp/things-to-do?window=tonight&limit=6",
          {
            signal: controller.signal,
            headers: { accept: "application/json" },
          },
        );
        if (!res.ok) {
          void Promise.resolve().then(() => {
            if (!controller.signal.aborted) setStatus("hidden");
          });
          return;
        }
        const body = (await res.json()) as ApiResponse;
        const opportunities = Array.isArray(body.opportunities)
          ? body.opportunities.filter((o) => o && typeof o.title === "string" && o.title.length > 0)
          : [];
        void Promise.resolve().then(() => {
          if (controller.signal.aborted) return;
          if (opportunities.length === 0) {
            setStatus("hidden");
          } else {
            setOps(opportunities);
            setStatus("ready");
          }
        });
      } catch {
        // Fail-soft: hide the lane entirely.
        void Promise.resolve().then(() => {
          if (!controller.signal.aborted) setStatus("hidden");
        });
      }
    })();
    return () => {
      controller.abort();
    };
  }, []);

  if (status !== "ready" || ops.length === 0) return null;

  return (
    <section
      className="discoverSection tonightNearbySection"
      aria-labelledby="tonightNearby-title"
    >
      <h2 id="tonightNearby-title" className="discoverSectionTitle">
        Tonight nearby
      </h2>
      <p className="discoverSectionDek">
        Curated things to do in London tonight — via CityMCP London. Grounded,
        upstream-sourced; no invented listings.
      </p>
      <div className="tonightNearbyGrid">
        {ops.map((op, idx) => {
          const link = opportunityHref(op);
          const kindLabel = labelForKind(op.kind);
          const area = op.place?.area ?? op.areas?.[0];
          return (
            <article
              key={`${op.title}-${idx}`}
              className="tonightNearbyCard"
              data-kind={op.kind ?? "other"}
            >
              <div className="tonightNearbyMeta">
                {kindLabel ? (
                  <span className="tonightNearbyKind">{kindLabel}</span>
                ) : null}
                {op.price ? (
                  <span className="tonightNearbyPrice">{op.price}</span>
                ) : null}
              </div>
              <h3 className="tonightNearbyTitle">{op.title}</h3>
              {op.place?.name || area ? (
                <p className="tonightNearbyPlace">
                  <MapPin size={12} aria-hidden="true" />
                  <span>
                    {op.place?.name ?? ""}
                    {op.place?.name && area ? " · " : ""}
                    {area ?? ""}
                  </span>
                </p>
              ) : null}
              {op.timeEvidence || op.availability ? (
                <p className="tonightNearbyWhen">
                  {op.timeEvidence ?? op.availability}
                </p>
              ) : null}
              {link ? (
                link.external ? (
                  <a
                    className="tonightNearbyLink"
                    href={link.href}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {op.source?.label ?? "Details"}
                    <ExternalLink size={13} aria-hidden="true" />
                  </a>
                ) : (
                  <Link className="tonightNearbyLink" href={link.href}>
                    Open on map
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </Link>
                )
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
