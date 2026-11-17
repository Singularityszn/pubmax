"use client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useFairPintPlan } from "./useFairPintPlan";
import FairPintCard, { type FairPintCounts } from "./FairPintCard";
import { createSlimShardLoader, type MapBounds } from "@/lib/slimShards";
import type { SlimVenue } from "@/lib/venuesSlim";
import type { CityId } from "@/lib/cities";
import { nearestNightAreaForViewport } from "@/lib/nightAreas";
import { fairPence, readFairPint, setFairPintSession, writeFairPint } from "@/lib/fairPint";
import { haptic } from "@/lib/nativeHaptics";
import { dismissMapFirstVisitArrival, setMapFirstVisitArrivalCardVisible } from "@/lib/mapFirstVisitArrival";

const FairPintResult = dynamic(() => import("./FairPintResult"));

function circleBounds(lat: number, lng: number, radiusKm: number): MapBounds {
  const dy = radiusKm / 110.574, dx = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
  return { west: lng - dx, east: lng + dx, south: lat - dy, north: lat + dy };
}
function inCircle(row: SlimVenue, lat: number, lng: number, km: number) {
  const rad = Math.PI / 180, a = Math.sin((row.lat - lat) * rad / 2) ** 2 + Math.cos(lat * rad) * Math.cos(row.lat * rad) * Math.sin((row.lng - lng) * rad / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= km;
}
export default function FairPintFlow({ cityId, bounds, center, onCommit, onRoute, mobile }: {
  mobile: boolean; cityId: CityId; bounds: MapBounds; center: [number, number]; onCommit: (pounds: number) => void; onRoute: (area: import("@/lib/nightAreas").NightAreaSlug | null, ids: string[], rows: SlimVenue[]) => void;
}) {
  const [start] = useState(readFairPint);
  const [committed, setCommitted] = useState(start);
  const [now] = useState(Date.now);
  const loader = useMemo(() => createSlimShardLoader(cityId), [cityId]);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [locationOff, setLocationOff] = useState(false);
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{ rows: SlimVenue[]; count: "loading" | "failed" | "ready"; draw: "loading" | "failed" | "ready"; countKey?: string; drawKey?: string }>({ rows: [], count: "loading", draw: "loading" });
  const area = nearestNightAreaForViewport(cityId, center);
  const plan = useFairPintPlan(cityId, area?.slug ?? "", (generated) => onRoute(generated.inferredContext.nightArea, generated.stops.map((stop) => stop.venueId), data.rows));
  const countBounds = position ? circleBounds(position.lat, position.lng, 0.8) : bounds;
  const drawBounds = area ? circleBounds(area.centre.lat, area.centre.lng, area.radiusKm) : bounds;
  const countKey = JSON.stringify(countBounds), drawKey = JSON.stringify(drawBounds);
  useEffect(() => {
    setFairPintSession(true, start); setMapFirstVisitArrivalCardVisible(true);
    const sync = () => setOffline(!navigator.onLine); sync();
    window.addEventListener("online", sync); window.addEventListener("offline", sync);
    return () => { setFairPintSession(false); setMapFirstVisitArrivalCardVisible(false); window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, [start]);
  useEffect(() => {
    let cancelled = false;
    const countBox: MapBounds = JSON.parse(countKey), drawBox: MapBounds = JSON.parse(drawKey);
    void Promise.all([loader.inBounds(countBox), loader.inBounds(drawBox)]).then(([countRows, drawRows]) => {
      if (cancelled) return;
      setData((held) => ({ countKey, drawKey, rows: [...new Map([...held.rows, ...countRows, ...drawRows].map((row) => [row.id, row])).values()], count: loader.coverageComplete(countBox) ? "ready" : "failed", draw: loader.coverageComplete(drawBox) ? "ready" : "failed" }));
      if (loader.coverageComplete(countBox)) performance.mark("fair_pint_ready");
    });
    return () => { cancelled = true; };
  }, [loader, countKey, drawKey, attempt]);
  const pricedRows = useMemo(() => data.rows.map((row) => ({ row, pence: fairPence(row, now) })), [data.rows, now]);
  const counts = (pence: number, draw = false): FairPintCounts => {
    const phase = draw ? data.drawKey === drawKey ? data.draw : "loading" : data.countKey === countKey ? data.count : "loading";
    if (phase !== "ready") return { phase };
    return { phase, count: pricedRows.filter(({ row, pence: listed }) => listed !== null && listed <= pence && (draw && area ? inCircle(row, area.centre.lat, area.centre.lng, area.radiusKm) : position ? inCircle(row, position.lat, position.lng, 0.8) : row.lng >= bounds.west && row.lng <= bounds.east && row.lat >= bounds.south && row.lat <= bounds.north)).length };
  };
  if (!area) return null;
  if (plan.state.last && plan.state.phase !== "dial") return <FairPintResult mobile={mobile} last={plan.state.last} venues={data.rows} start={plan.start} busy={plan.state.phase === "drawing"} error={plan.state.error} onStart={plan.changeStart} onBack={plan.back} />;
  return <><FairPintCard start={committed} area={area.name} counts={(pence) => counts(pence)} drawCounts={(pence) => counts(pence, true)} located={position !== null} locationOff={locationOff} offline={offline} drawUnavailable={plan.retrying} pending={plan.state.phase === "drawing"} error={plan.state.error}
    onInput={(pence) => setFairPintSession(true, pence)}
    onCommit={(pence) => { setCommitted(pence); writeFairPint(pence); onCommit(pence / 100); void haptic("selection-kept"); }}
    onLocation={() => { if (!navigator.geolocation) { setLocationOff(true); return; } navigator.geolocation.getCurrentPosition((value) => { setPosition({ lat: value.coords.latitude, lng: value.coords.longitude }); setLocationOff(false); }, () => setLocationOff(true)); }}
    onRetry={() => setAttempt((held) => held + 1)} onClose={() => dismissMapFirstVisitArrival(undefined, Date.now(), true)}
    onDraw={(pence) => { if (plan.retrying) return; void import("./FairPintResult"); void plan.draw(pence); }} /></>;
}
