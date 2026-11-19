"use client";
import { useEffect, useMemo, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import type { useFairPintPlan } from "./useFairPintPlan";
import type { FairPintGenerated } from "@/lib/fairPint";
import FairPintCard, { type FairPintCounts } from "./FairPintCard";
import { createSlimShardLoader, type MapBounds } from "@/lib/slimShards";
import type { SlimVenue } from "@/lib/venuesSlim";
import type { CityId } from "@/lib/cities";
import { nearestNightAreaForViewport } from "@/lib/nightAreas";
import type { fairPence } from "@/lib/fairPintPricing";
import { readFairPint, setFairPintSession, writeFairPint, takeEarlyFairPint } from "@/lib/fairPint";
import { latchMapReaderLocationWatch, mapReaderPositionFromGeolocation, mapReaderPositionInView, mapReaderPositionMeasures, type MapReaderPosition } from "@/lib/mapReaderPosition";
import { mapReaderOnCanvas, subscribeMapReaderOnCanvas } from "@/lib/mapReaderOnCanvas";
import { dismissMapFirstVisitArrival, setMapFirstVisitArrivalCardVisible } from "@/lib/mapFirstVisitArrival";
import { retryablePlannerImport } from "./retryablePlannerImport";

const loadPlanner = retryablePlannerImport(() => import("./FairPintPlanner"));

const selectionHaptic = () => {
  void import("@/lib/nativeHaptics").then(({ haptic }) => haptic("selection-kept")).catch(() => {});
};
const mapSearchControl = () => [...document.querySelectorAll<HTMLElement>('[aria-label="Search the map"], .mapToolbar input')]
  .find((element) => element.getClientRects().length > 0) ?? null;
const resultReturnFocus = () => document.querySelector<HTMLElement>(".fairPintCard:not([data-fair-prelude]) input.fairPintRange") ?? mapSearchControl();


function circleBounds(lat: number, lng: number, radiusKm: number): MapBounds {
  const dy = radiusKm / 110.574,
    dx = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { west: lng - dx, east: lng + dx, south: lat - dy, north: lat + dy };
}
function marginBounds(box: MapBounds, marginKm: number): MapBounds {
  const dy = marginKm / 110.574,
    dx = marginKm / (111.32 * Math.cos((((box.south + box.north) / 2) * Math.PI) / 180));
  return { west: box.west - dx, east: box.east + dx, south: box.south - dy, north: box.north + dy };
}
function inCircle(row: SlimVenue, lat: number, lng: number, km: number) {
  const rad = Math.PI / 180,
    a =
      Math.sin(((row.lat - lat) * rad) / 2) ** 2 +
      Math.cos(lat * rad) * Math.cos(row.lat * rad) * Math.sin(((row.lng - lng) * rad) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= km;
}
type LoadPhase = "loading" | "failed" | "ready";
type PriceRead = "count" | "margin" | "circle" | "draw";
type PriceReads = {
  rows: SlimVenue[];
  /** The boxes whose rows are all in `rows`. Written with those rows, so a count never runs ahead of them. */
  covered: MapBounds[];
} & Record<PriceRead, LoadPhase> & Partial<Record<`${PriceRead}Key`, string>>;
const COVERED_BOXES_HELD = 8;
const contains = (outer: MapBounds, inner: MapBounds) =>
  outer.west <= inner.west && outer.east >= inner.east && outer.south <= inner.south && outer.north >= inner.north;

/** One price read for one box. A null key reads nothing; a new key drops the old answer. */
function usePriceRead(
  loader: ReturnType<typeof createSlimShardLoader>,
  kind: PriceRead,
  key: string | null,
  attempt: number,
  setData: Dispatch<SetStateAction<PriceReads>>,
) {
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const box: MapBounds = JSON.parse(key);
    void loader.inBounds(box).then((rows) => {
      const ready = loader.coverageComplete(box);
      setData((held) => ({
        ...held,
        rows: [...new Map([...held.rows, ...rows].map((row) => [row.id, row])).values()],
        covered: ready ? [box, ...held.covered].slice(0, COVERED_BOXES_HELD) : held.covered,
        ...(!cancelled ? { [`${kind}Key`]: key, [kind]: ready ? "ready" : "failed" } : {}),
      }));
      // The view's own read, for every reader. A near count can answer later.
      if (!cancelled && kind === "count" && ready) performance.mark("fair_pint_ready");
    });
    return () => {
      cancelled = true;
    };
  }, [loader, kind, key, attempt, setData]);
}

export default function FairPintFlow({
  priceReader,
  cityId,
  bounds,
  center,
  onCommit,
  onRoute,
  mobile,
  readerPosition = null,
}: {
  priceReader: typeof fairPence;
  readerPosition?: MapReaderPosition | null;
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
  const [viewOnly, setViewOnly] = useState(false);
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [returnToCard, setReturnToCard] = useState(false);
  const [typedName, setTypedName] = useState<string | null>(null);
  const [Planner, setPlanner] = useState<typeof import("./FairPintPlanner").default | null>(null);
  const [plannerFailed, setPlannerFailed] = useState(false);
  const [plannerAttempt, setPlannerAttempt] = useState(0);
  const [firstDraw, setFirstDraw] = useState<{ pence: number; area: string } | null>(null);
  useEffect(() => {
    if (!firstDraw || Planner) return;
    let cancelled = false;
    void loadPlanner(() => { if (!cancelled) setPlannerFailed(true); })
      .then((loaded) => { if (!cancelled) setPlanner(() => loaded.default); })
      .catch(() => { if (!cancelled) setPlannerFailed(true); });
    return () => { cancelled = true; };
  }, [firstDraw, Planner, plannerAttempt]);
  const [data, setData] = useState<PriceReads>({ rows: [], covered: [], count: "loading", margin: "loading", circle: "loading", draw: "loading" });
  const area = nearestNightAreaForViewport(cityId, center);
  const activateRoute = (generated: FairPintGenerated) =>
    onRoute(
      generated.inferredContext.nightArea,
      generated.stops.map((stop) => stop.venueId),
      data.rows.filter((row) => generated.stops.some((stop) => stop.venueId === row.id)),
    );
  // The dot counts when the canvas shows it. A coarse fix draws its ring on
  // the map and counts only if the reader asks. Before a map answers, the
  // view's bounds stand in for the canvas.
  const readerOnCanvas = useSyncExternalStore(subscribeMapReaderOnCanvas, mapReaderOnCanvas, () => null);
  const readerInView = mapReaderPositionMeasures(readerPosition) && readerOnCanvas !== false
    ? mapReaderPositionInView(readerPosition, bounds)
    : null;
  // The dot counts while it is on screen. Off screen, only the fix the reader
  // gave with a tap counts, so a later fix of the watch never moves a request.
  const position = viewOnly ? null : (readerInView ?? chosenPosition);
  // Four price reads, and no fix of the watch picks any of them. The view
  // answers the in-view count alone. A fixed margin round the view answers the
  // near count for a dot on screen, and is read only once a dot is there. A
  // circle round the fix a tap gave answers the near count off screen.
  const drawBounds = area ? circleBounds(area.centre.lat, area.centre.lng, area.radiusKm) : bounds;
  const countKey = JSON.stringify(bounds),
    marginKey = readerInView && !viewOnly ? JSON.stringify(marginBounds(bounds, 0.8)) : null,
    circleKey = chosenPosition ? JSON.stringify(circleBounds(chosenPosition.lat, chosenPosition.lng, 0.8)) : null,
    drawKey = JSON.stringify(drawBounds);
  const nearRead = readerInView ? "margin" : "circle";
  useEffect(() => {
    let mounted = true;
    const pendingReleases = early ? early.releases - (early.handledReleases ?? 0) : 0;
    if (early && pendingReleases > 0) {
      writeFairPint(early.pence);
      onCommit(early.pence / 100);
      for (let index = 0; index < pendingReleases; index++) selectionHaptic();
    }
    void early?.location?.then((fix) => {
      if (!mounted) return;
      const position = fix ? mapReaderPositionFromGeolocation(fix) : null;
      setPosition(position);
      setLocationOff(!position);
      if (position) latchMapReaderLocationWatch();
    });
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
  usePriceRead(loader, "count", countKey, attempt, setData);
  usePriceRead(loader, "margin", marginKey, attempt, setData);
  usePriceRead(loader, "circle", circleKey, attempt, setData);
  usePriceRead(loader, "draw", drawKey, attempt, setData);
  // The near count answers once a finished read holds every row round the
  // position, whichever read that was. A pan keeps the answer the last margin
  // gave, and a later read that failed says nothing about those 800 m.
  const nearPhase = (at: { lat: number; lng: number }): LoadPhase => {
    const circle = circleBounds(at.lat, at.lng, 0.8);
    if (data.covered.some((box) => contains(box, circle))) return "ready";
    const answered = nearRead === "margin" ? data.marginKey === marginKey : data.circleKey === circleKey;
    return answered ? "failed" : "loading";
  };
  const pricedRows = useMemo(() => data.rows.map((row) => ({ row, pence: priceReader(row, now) })), [data.rows, now, priceReader]);
  const counts = (pence: number, draw = false): FairPintCounts => {
    const phase = draw
      ? data.drawKey === drawKey
        ? data.draw
        : "loading"
      : position
        ? nearPhase(position)
        : data.countKey === countKey ? data.count : "loading";
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
  if (!area) return null;
  const render = (plan?: ReturnType<typeof useFairPintPlan>) => {
  const close = () => {
    setFairPintSession(false);
    dismissMapFirstVisitArrival(undefined, Date.now(), true);
    if (!plan || plan.state.phase === "dial") mapSearchControl()?.focus({ preventScroll: true });
  };
  return (
    <>
      <FairPintCard
        focusOnMount={returnToCard}
        start={committed}
        area={area.name}
        counts={(pence) => counts(pence)}
        drawCounts={(pence) => counts(pence, true)}
        located={position !== null}
        locationOff={locationOff && !readerPosition && !chosenPosition}
        offline={offline}
        drawUnavailable={plannerFailed || (plan?.retrying ?? false)}
        loadFailed={plannerFailed}
        pending={!plannerFailed && firstDraw !== null && (!plan || plan.state.phase === "drawing")}
        error={plannerFailed ? "Could not load your night. Try again." : plan?.state.error ?? ""}
        onInput={(pence) => setFairPintSession(true, pence)}
        onCommit={(pence) => {
          setCommitted(pence);
          writeFairPint(pence);
          onCommit(pence / 100);
          selectionHaptic();
        }}
        onLocation={() => {
          if (position) {
            setViewOnly(true);
            return;
          }
          setViewOnly(false);
          if (readerInView) return;
          // The map already holds a fix. Each tap offers the newest one, with
          // no second ask.
          if (readerPosition) {
            setPosition(readerPosition);
            setLocationOff(false);
            return;
          }
          if (chosenPosition) return;
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
        onRetry={() => {
          if (plannerFailed) {
            setPlannerFailed(false);
            setPlannerAttempt((held) => held + 1);
          } else setAttempt((held) => held + 1);
        }}
        onClose={close}
        onDraw={(pence) => {
          if (plan?.retrying) return;
          void import("@/lib/planIntake").catch(() => {});
          if (plan) void plan.draw(pence);
          else {
            setCommitted(pence);
            setFirstDraw({ pence, area: area.slug });
          }
        }}
      />
    </>
  );
  };
  return firstDraw === null || !Planner ? render() : (
      <Planner
        cityId={cityId} area={area.slug} initialArea={firstDraw.area} pence={firstDraw.pence} onGenerated={activateRoute}
        resultProps={{ typedName, onName: setTypedName, mobile, venues: data.rows, returnFocus: resultReturnFocus,
          onClose: () => { setFairPintSession(false); dismissMapFirstVisitArrival(undefined, Date.now(), true); },
          onBack: () => setReturnToCard(true) }}
      >
        {render}
      </Planner>
  );
}
