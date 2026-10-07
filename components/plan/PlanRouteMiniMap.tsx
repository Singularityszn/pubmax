"use client";

import type { Route } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { WalkLegDistance } from "@/lib/walkRoute";

import {
  lineCoordsFromFeatureCollection,
  stopsParam,
  type LngLat,
} from "@/lib/routeMiniMap";
import {
  planCrawlRouteGeoJSON,
  type PlanCrawlRouteStop,
  type ResolvedPlanCrawlRoute,
} from "@/lib/planCrawlRouteMap";
import { discardBody } from "@/lib/responseBody";
import { probeWebGl2 } from "@/components/map/canvas/webgl";

const PlanCrawlRouteMapCanvas = dynamic(
  () => import("@/components/map/canvas/PlanCrawlRouteMapCanvas"),
  {
    ssr: false,
    loading: () => <div className="planRouteMiniMap__canvas planRouteMiniMap__canvas--loading" aria-hidden="true" />,
  },
);

type RouteSource = "ors" | "straight";

async function fetchStopCoords(
  stops: PlanCrawlRouteStop[],
  signal: AbortSignal,
): Promise<ResolvedPlanCrawlRoute | null> {
  const results = await Promise.all(
    stops.map(async (stop) => {
      try {
        const res = await fetch(`/api/venue/${encodeURIComponent(stop.venueId)}`, {
          signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { venue?: unknown };
        const venue = body.venue as
          | { latitude?: unknown; longitude?: unknown; primaryBorough?: unknown }
          | undefined;
        const lat = venue?.latitude;
        const lng = venue?.longitude;
        if (typeof lat !== "number" || typeof lng !== "number") return null;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          coord: [lng, lat] as LngLat,
          name: stop.venueName,
          venueId: stop.venueId,
          area: typeof venue?.primaryBorough === "string" ? venue.primaryBorough : "",
        };
      } catch {
        return null;
      }
    }),
  );
  if (results.some((row) => row === null)) return null;
  const rows = results as NonNullable<(typeof results)[number]>[];
  if (rows.length < 2) return null;
  return {
    coords: rows.map((row) => row.coord),
    names: rows.map((row) => row.name),
    venueIds: rows.map((row) => row.venueId),
    area: rows.find((row) => row.area)?.area ?? "",
  };
}

type DrawnRoute = { line: LngLat[]; source: RouteSource };

export default function PlanRouteMiniMap({
  stops,
  mapHref,
  variant = "card",
  drawKey,
  onLegs,
}: {
  stops: PlanCrawlRouteStop[];
  mapHref?: Route | null;
  /** `strip` is the Plan result's frameless route under its header. */
  variant?: "card" | "strip";
  /** A route that has just arrived, so its line draws itself once. */
  drawKey?: string;
  /** The measured walk between stops, once the walking route answers. */
  onLegs?: (venueIds: readonly string[], legs: readonly WalkLegDistance[]) => void;
}) {
  const attributionSlotRef = useRef<HTMLDivElement | null>(null);
  const onLegsRef = useRef(onLegs);
  useEffect(() => {
    onLegsRef.current = onLegs;
  }, [onLegs]);
  const [resolved, setResolved] = useState<ResolvedPlanCrawlRoute | null>(null);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [drawn, setDrawn] = useState<DrawnRoute | null>(null);
  const [drawnKey, setDrawnKey] = useState<string | null>(null);

  const stopsKey = JSON.stringify(
    stops.map(({ venueId, venueName, position }) => ({ venueId, venueName, position })),
  );
  const titleId = useId();
  const descId = useId();

  const [noWebGl, setNoWebGl] = useState(false);
  useEffect(() => {
    if (!probeWebGl2().hasContext) {
      // Deferred out of the effect body (react-hooks/set-state-in-effect).
      void Promise.resolve().then(() => setNoWebGl(true));
      return;
    }
    const controller = new AbortController();
    void fetchStopCoords(stops, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      if (!next) {
        setResolved(null);
        setResolvedKey(stopsKey);
        setDrawn(null);
        setDrawnKey(stopsKey);
        return;
      }
      setResolved(next);
      setResolvedKey(stopsKey);
      setDrawn({ line: next.coords, source: "straight" });
      setDrawnKey(stopsKey);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey]);

  useEffect(() => {
    if (!resolved || resolvedKey !== stopsKey) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/walk-route?stops=${encodeURIComponent(stopsParam(resolved.coords))}`,
          { signal: controller.signal, headers: { accept: "application/json" } },
        );
        if (!res.ok) {
          discardBody(res);
          return;
        }
        const body = (await res.json()) as { line?: unknown; source?: unknown; legs?: unknown };
        if (Array.isArray(body.legs) && !controller.signal.aborted) {
          onLegsRef.current?.(resolved.venueIds, body.legs as WalkLegDistance[]);
        }
        const routed = lineCoordsFromFeatureCollection(body.line);
        if (controller.signal.aborted || routed.length < 2) return;
        setDrawn({
          line: routed,
          source: body.source === "ors" ? "ors" : "straight",
        });
        setDrawnKey(stopsKey);
      } catch {
        /* keep straight segments */
      }
    })();
    return () => controller.abort();
  }, [resolved, resolvedKey, stopsKey]);

  const activeResolved = resolvedKey === stopsKey ? resolved : null;
  const activeDrawn = drawnKey === stopsKey ? drawn : null;

  const geo = useMemo(() => {
    if (!activeResolved || !activeDrawn) return null;
    return planCrawlRouteGeoJSON(activeResolved, activeDrawn.line, activeDrawn.source);
  }, [activeResolved, activeDrawn]);

  if (!activeResolved || !activeDrawn || !geo) {
    // The strip holds its height while the stops are located, so the cards
    // under it do not jump when the map arrives. It gives the space back only
    // once there is nothing to draw (no WebGL, or fewer than two located stops).
    const settled = noWebGl || resolvedKey === stopsKey;
    if (variant !== "strip" || settled) return null;
    return (
      <div className="planRouteMiniMap planRouteMiniMap--strip" aria-hidden="true" data-testid="plan-route-strip-pending">
        <div className="planRouteMiniMap__canvas planRouteMiniMap__canvas--loading" />
      </div>
    );
  }

  const count = activeResolved.coords.length;
  const title = activeResolved.area
    ? `Route map: ${count} stops in ${activeResolved.area}`
    : `Route map: ${count} stops`;
  const description = `Walking route between ${activeResolved.names.join(", ")}.`;

  const labelledBy = `${titleId} ${descId}`;
  const preview = (
    <>
      <p id={titleId} className="planRouteMiniMap__title">
        {title}
      </p>
      <p id={descId} className="planRouteMiniMap__srOnly">
        {description}
      </p>
      <PlanCrawlRouteMapCanvas
        drawKey={drawKey}
        stopCoords={activeResolved.coords}
        routeLine={geo.routeLine}
        routeStops={geo.routeStops}
        lineCoords={activeDrawn.line}
        attributionSlotRef={attributionSlotRef}
      />
    </>
  );

  return (
    <div
      className={`planRouteMiniMap planRouteMiniMap--in${variant === "strip" ? " planRouteMiniMap--strip" : ""}`}
      data-source={activeDrawn.source}
      data-testid={variant === "strip" ? "plan-route-strip" : undefined}
    >
      {mapHref ? (
        <Link className="planRouteMiniMap--clickable" href={mapHref} prefetch={false} aria-labelledby={labelledBy}>
          {preview}
        </Link>
      ) : (
        <div role="group" aria-labelledby={labelledBy}>
          {preview}
        </div>
      )}
      {/* MapLibre's credit button cannot sit inside this link or inside the
          aria-hidden canvas: either one is a nested or hidden control. */}
      <div ref={attributionSlotRef} className="planRouteMiniMap__attrib" />
    </div>
  );
}
