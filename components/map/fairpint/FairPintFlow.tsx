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
import { readFairPint, setFairPintSession, writeFairPint, takeEarlyFairPint, fairPintArrivalPence, validFairPint } from "@/lib/fairPint";
import { latchMapReaderLocationWatch, mapReaderPositionFromGeolocation, mapReaderPositionInView, mapReaderPositionMeasures, type MapReaderPosition } from "@/lib/mapReaderPosition";
import { mapReaderOnCanvas, subscribeMapReaderOnCanvas } from "@/lib/mapReaderOnCanvas";
import { dismissMapFirstVisitArrival, setMapFirstVisitArrivalCardVisible } from "@/lib/mapFirstVisitArrival";
import { retryablePlannerImport } from "./retryablePlannerImport";
import { haversineMeters } from "@/lib/greatCircle.mjs";

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
    // The edge nearest a pole, where a kilometre spans the most longitude, so
    // the margin holds the 800 m round a dot anywhere in the view.
    dx = marginKm / (111.32 * Math.cos((Math.max(Math.abs(box.south), Math.abs(box.north)) * Math.PI) / 180));
  return { west: box.west - dx, east: box.east + dx, south: box.south - dy, north: box.north + dy };
}
function inCircle(row: SlimVenue, lat: number, lng: number, km: number) {
  return haversineMeters(lat, lng, row.lat, row.lng) <= km * 1_000;
}
type LoadPhase = "loading" | "failed" | "ready";
type PriceRead = "count" | "margin" | "circle" | "draw";
/** Only the view and the draw area keep a phase. A near read answers through its key and the delivered rows. */
type PhasedRead = Extract<PriceRead, "count" | "draw">;
type PriceReads = {
  rows: SlimVenue[];
  /** The loader's hand-over count this card has stored rows up to. */
  seen: number;
} & Record<PhasedRead, LoadPhase> & Partial<Record<`${PriceRead}Key`, string>>;

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
      const seen = loader.deliveryCount();
      setData((held) => ({
        ...held,
        seen: Math.max(held.seen, seen),
        rows: [...new Map([...held.rows, ...rows].map((row) => [row.id, row])).values()],
        ...(!cancelled ? { [`${kind}Key`]: key } : {}),
        ...(!cancelled && (kind === "count" || kind === "draw") ? { [kind]: ready ? "ready" : "failed" } : {}),
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
  const [arrivalPence] = useState(() => fairPintArrivalPence(location.search, validFairPint));
  const [start] = useState(() => early?.pence ?? arrivalPence ?? readFairPint());
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
  const [data, setData] = useState<PriceReads>({ rows: [], seen: 0, count: "loading", draw: "loading" });
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
  const onCanvas = useSyncExternalStore(subscribeMapReaderOnCanvas, mapReaderOnCanvas, () => null);
  const readerInView = readerPosition && mapReaderPositionMeasures(readerPosition) && onCanvas?.(readerPosition.lat, readerPosition.lng) !== false
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
    circleKey = chosenPosition && !readerInView && !viewOnly ? JSON.stringify(circleBounds(chosenPosition.lat, chosenPosition.lng, 0.8)) : null,
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
      // A coarse answer shows its ring on the map and counts nothing.
      setPosition(mapReaderPositionMeasures(position) ? position : null);
      setLocationOff(!position);
      if (position) latchMapReaderLocationWatch();
    });
    setFairPintSession(true, start, arrivalPence !== null || !!early?.dragging || (early?.releases ?? 0) > 0);
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
  // The near count answers once a read has handed over the rows of every
  // price file round the position, whichever read that was. The loader marks
  // a file delivered in the step that returns its rows, and that read's state
  // update is queued before any render, so the count never runs ahead of its
  // rows. A pan keeps the answer, and a file that failed anywhere else says
  // nothing about those 800 m.
  const nearPhase = (at: { lat: number; lng: number }): LoadPhase => {
    // The loader hands rows over one step before this card stores them. Until
    // the card has stored every hand-over, the count waits.
    const delivered = loader.rowsDelivered(circleBounds(at.lat, at.lng, 0.8));
    if (delivered) return data.seen === loader.deliveryCount() ? "ready" : "loading";
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
        // A cancelled touch hands back the held price, which is not a move.
        onInput={(pence) => setFairPintSession(true, pence, pence !== committed ? true : undefined)}
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
          // The map already holds a fix fine enough to count from. Each tap
          // offers the newest one, with no second ask. A coarse fix is asked
          // for again, so the card and the venue sheet judge one fix alike.
          if (readerPosition && mapReaderPositionMeasures(readerPosition)) {
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
              // A coarse answer shows its ring on the map and counts nothing.
              setPosition(mapReaderPositionMeasures(position) ? position : null);
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
          setFairPintSession(true, pence, true);
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
