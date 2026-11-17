"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useFairPintPlan, warmFairPintTime } from "./useFairPintPlan";
import FairPintCard, { type FairPintCounts } from "./FairPintCard";
import { createSlimShardLoader, type MapBounds } from "@/lib/slimShards";
import type { SlimVenue } from "@/lib/venuesSlim";
import type { CityId } from "@/lib/cities";
import { nearestNightAreaForViewport } from "@/lib/nightAreas";
import { fairPence } from "@/lib/fairPintPricing";
import { readFairPint, setFairPintSession, writeFairPint, takeEarlyFairPint } from "@/lib/fairPint";
import { latchMapReaderLocationWatch, mapReaderPositionFromGeolocation } from "@/lib/mapReaderPosition";
import { haptic } from "@/lib/nativeHaptics";
import { dismissMapFirstVisitArrival, setMapFirstVisitArrivalCardVisible } from "@/lib/mapFirstVisitArrival";
import CrawlPresentationBoundary from "@/components/wild/CrawlPresentationBoundary";
import FairPintResultFallback from "./FairPintResultFallback";

const FairPintResult = dynamic(() => import("./FairPintResult"));

function circleBounds(lat: number, lng: number, radiusKm: number): MapBounds {
  const dy = radiusKm / 110.574,
    dx = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { west: lng - dx, east: lng + dx, south: lat - dy, north: lat + dy };
}
function inCircle(row: SlimVenue, lat: number, lng: number, km: number) {
  const rad = Math.PI / 180,
    a =
      Math.sin(((row.lat - lat) * rad) / 2) ** 2 +
      Math.cos(lat * rad) * Math.cos(row.lat * rad) * Math.sin(((row.lng - lng) * rad) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= km;
}
export default function FairPintFlow({
  cityId,
  bounds,
  center,
  onCommit,
  onRoute,
  mobile,
  readerPosition = null,
}: {
  readerPosition?: { lat: number; lng: number } | null;
  mobile: boolean;
  cityId: CityId;
  bounds: MapBounds;
  center: [number, number];
  onCommit: (pounds: number) => void;
  onRoute: (area: import("@/lib/nightAreas").NightAreaSlug | null, ids: string[], rows: SlimVenue[]) => void;
}) {
  const [early] = useState(takeEarlyFairPint);
  const [start] = useState(() => early?.pence ?? readFairPint());
  const [committed, setCommitted] = useState(start);
  const [now] = useState(Date.now);
  const loader = useMemo(() => createSlimShardLoader(cityId), [cityId]);
  const [chosenPosition, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [locationOff, setLocationOff] = useState(false);
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [returnToCard, setReturnToCard] = useState(false);
  const [data, setData] = useState<{
    rows: SlimVenue[];
    count: "loading" | "failed" | "ready";
    draw: "loading" | "failed" | "ready";
    countKey?: string;
    drawKey?: string;
  }>({ rows: [], count: "loading", draw: "loading" });
  const area = nearestNightAreaForViewport(cityId, center);
  const plan = useFairPintPlan(cityId, area?.slug ?? "", (generated) =>
    onRoute(
      generated.inferredContext.nightArea,
      generated.stops.map((stop) => stop.venueId),
      data.rows.filter((row) => generated.stops.some((stop) => stop.venueId === row.id)),
    ),
  );
  const position = chosenPosition === null ? null : (readerPosition ?? chosenPosition);
  const countBounds = position ? circleBounds(position.lat, position.lng, 0.8) : bounds;
  const drawBounds = area ? circleBounds(area.centre.lat, area.centre.lng, area.radiusKm) : bounds;
  const countKey = JSON.stringify(countBounds),
    drawKey = JSON.stringify(drawBounds);
  useEffect(() => {
    let mounted = true;
    const pendingReleases = early ? early.releases - (early.handledReleases ?? 0) : 0;
    if (early && pendingReleases > 0) {
      writeFairPint(early.pence);
      onCommit(early.pence / 100);
      for (let index = 0; index < pendingReleases; index++) void haptic("selection-kept");
    }
    void early?.location?.then((fix) => {
      if (!mounted) return;
      const position = fix ? mapReaderPositionFromGeolocation(fix) : null;
      setPosition(position);
      setLocationOff(!position);
      if (position) latchMapReaderLocationWatch();
    });
    void warmFairPintTime().catch(() => {});
    void import("./FairPintResult").catch(() => {});
    setFairPintSession(true, start);
    setMapFirstVisitArrivalCardVisible(true);
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      mounted = false;
      setFairPintSession(false);
      setMapFirstVisitArrivalCardVisible(false);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
    // The bootstrap handoff is consumed once for this mounted flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, early]);
  useEffect(() => {
    let cancelled = false;
    const countBox: MapBounds = JSON.parse(countKey),
      drawBox: MapBounds = JSON.parse(drawKey);
    const load = async (box: MapBounds, kind: "count" | "draw") => {
      const rows = await loader.inBounds(box);
      if (cancelled) return;
      const ready = loader.coverageComplete(box);
      setData((held) => ({
        ...held,
        [kind + "Key"]: kind === "count" ? countKey : drawKey,
        rows: [...new Map([...held.rows, ...rows].map((row) => [row.id, row])).values()],
        [kind]: ready ? "ready" : "failed",
      }));
      if (kind === "count" && ready) performance.mark("fair_pint_ready");
    };
    void load(countBox, "count");
    void load(drawBox, "draw");
    return () => {
      cancelled = true;
    };
  }, [loader, countKey, drawKey, attempt]);
  const pricedRows = useMemo(() => data.rows.map((row) => ({ row, pence: fairPence(row, now) })), [data.rows, now]);
  const counts = (pence: number, draw = false): FairPintCounts => {
    const phase = draw
      ? data.drawKey === drawKey
        ? data.draw
        : "loading"
      : data.countKey === countKey
        ? data.count
        : "loading";
    if (phase !== "ready") return { phase };
    return {
      phase,
      count: pricedRows.filter(
        ({ row, pence: listed }) =>
          listed !== null &&
          listed <= pence &&
          (draw && area
            ? inCircle(row, area.centre.lat, area.centre.lng, area.radiusKm)
            : position
              ? inCircle(row, position.lat, position.lng, 0.8)
              : row.lng >= bounds.west && row.lng <= bounds.east && row.lat >= bounds.south && row.lat <= bounds.north),
      ).length,
    };
  };
  const close = () => {
    setFairPintSession(false);
    dismissMapFirstVisitArrival(undefined, Date.now(), true);
    queueMicrotask(() => document.querySelector<HTMLElement>('[aria-label="Search the map"], .mapToolbar input')?.focus({ preventScroll: true }));
  };
  const back = () => {
    setReturnToCard(true);
    plan.back();
  };
  if (!area) return null;
  if (plan.state.last && plan.state.phase !== "dial")
    return (
      <CrawlPresentationBoundary
        key={plan.state.last.generated.operationKey}
        fallback={<FairPintResultFallback last={plan.state.last} onBack={back} />}
      >
        <FairPintResult
          onLineReady={plan.lineReady}
          onEditStart={plan.editStart}
          cityId={cityId}
          onClose={close}
          mobile={mobile}
          last={plan.state.last}
          venues={data.rows}
          start={plan.start}
          busy={plan.state.phase === "drawing"}
          error={plan.state.error}
          onStart={plan.changeStart}
          onBack={back}
        />
      </CrawlPresentationBoundary>
    );
  return (
    <>
      <FairPintCard
        focusOnMount={returnToCard}
        start={committed}
        area={area.name}
        counts={(pence) => counts(pence)}
        drawCounts={(pence) => counts(pence, true)}
        located={position !== null}
        locationOff={locationOff}
        offline={offline}
        drawUnavailable={plan.retrying}
        pending={plan.state.phase === "drawing"}
        error={plan.state.error}
        onInput={(pence) => setFairPintSession(true, pence)}
        onCommit={(pence) => {
          setCommitted(pence);
          writeFairPint(pence);
          onCommit(pence / 100);
          void haptic("selection-kept");
        }}
        onLocation={() => {
          if (!navigator.geolocation) {
            setLocationOff(true);
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (value) => {
              const position = mapReaderPositionFromGeolocation(value);
              setPosition(position);
              setLocationOff(!position);
              if (position) latchMapReaderLocationWatch();
            },
            () => {
              setPosition(null);
              setLocationOff(true);
            },
          );
        }}
        onRetry={() => setAttempt((held) => held + 1)}
        onClose={close}
        onDraw={(pence) => {
          if (plan.retrying) return;
          void import("./FairPintResult").catch(() => {});
          void plan.draw(pence);
        }}
      />
    </>
  );
}
