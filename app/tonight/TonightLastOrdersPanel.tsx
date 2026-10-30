"use client";

// Last orders: the pubs near you that their SOURCED hours say stay open at
// least 30 more minutes, each with a live countdown, and one line on getting
// home. Loaded only when the door opens (TonightLastOrdersDoor). It reads two
// static packs and the existing /api/last-train answer, and writes nothing.
//
// Honesty: a pub whose hours are missing, unreadable, or silent on a bank
// holiday is left off, never shown open (lib/lastOrders.ts). A train time comes
// only from /api/last-train; with no answer the line says so and stops.

import type { Route } from "next";
import Link from "next/link";
import { TrainFront, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { PintPriceBadge } from "@/components/PriceBadge";
import { Button } from "@/components/ui/button";
import { RowList, RowListItem } from "@/components/ui/row-list";
import { getCity } from "@/lib/cities";
import { formatObservedDate, formatSnapshotFrom } from "@/lib/dataFreshness";
import { oldestPintRead } from "@/lib/drinks";
import { LOCATION_FINDING_LABEL, LOCATION_SHARE_LABEL } from "@/lib/locationDisclosure";
import {
  isLastOrdersHour,
  LAST_ORDERS_HOURS_PATH,
  LAST_ORDERS_MAP_PARAM,
  LAST_ORDERS_MIN_MINUTES,
  LAST_ORDERS_ORDER_LINE,
  LAST_ORDERS_PRICES_PATH,
  lastOrdersCountdownLabel,
  parseLastOrdersHoursPack,
  parseLastOrdersPricesPack,
  rankLastOrders,
  type LastOrdersHoursPack,
  type LastOrdersPrice,
  type LastOrdersRow,
} from "@/lib/lastOrdersList";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import type { TonightNear } from "@/lib/tonight";

import { useTonightGetHome, type GetHome } from "./useTonightGetHome";
import { useLiveClock } from "@/lib/useLiveClock";
import { useNightDarkTheme } from "@/lib/useNightDarkTheme";

import "./tonightLastOrders.css";

/** How often the countdowns move. A minute figure needs nothing faster. */
const TICK_MS = 30_000;

type Packs =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; hours: LastOrdersHoursPack; prices: ReadonlyMap<string, LastOrdersPrice> };

// Both packs go through the shared surface cache, so a returning tab paints the
// last answer at once. Prices are optional: a failed price read lists the
// pubs with no price rather than failing the list.
function useLastOrdersPacks(): [Packs, () => void] {
  const [packs, setPacks] = useState<Packs>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let hours: LastOrdersHoursPack | null = null;
    let prices: ReadonlyMap<string, LastOrdersPrice> = new Map();
    const paint = () => {
      if (hours && !controller.signal.aborted) setPacks({ status: "ready", hours, prices });
    };
    void Promise.all([
      loadSurfaceJson<unknown>(
        LAST_ORDERS_HOURS_PATH,
        { signal: controller.signal, validate: (body) => parseLastOrdersHoursPack(body) !== null },
        (body) => {
          hours = parseLastOrdersHoursPack(body);
          paint();
        },
      ),
      loadSurfaceJson<unknown>(LAST_ORDERS_PRICES_PATH, { signal: controller.signal }, (body) => {
        prices = parseLastOrdersPricesPack(body);
        paint();
      }),
    ]).then(([hoursOutcome]) => {
      if (hoursOutcome === "failed" && !controller.signal.aborted) setPacks({ status: "failed" });
    });
    return () => controller.abort();
  }, [attempt]);
  const retry = useCallback(() => {
    setPacks({ status: "loading" });
    setAttempt((count) => count + 1);
  }, []);
  return [packs, retry];
}

function Countdown({ row }: { row: LastOrdersRow }) {
  const label = lastOrdersCountdownLabel(row);
  // The figure is set apart so it reads big; the words stay in the body face.
  const match = /^(Open )(\d+)( more min)$/.exec(label);
  return (
    <span
      className="lastOrdersCountdown"
      data-testid="last-orders-countdown"
      data-urgent={row.minutesLeft !== null && row.minutesLeft < 45 ? "true" : undefined}
    >
      {match ? (
        <>
          {match[1]}
          <span className="lastOrdersCountdownFigure">{match[2]}</span>
          {match[3]}
        </>
      ) : (
        label
      )}
    </span>
  );
}

function GetHomeLine({
  getHome,
  onShareLocation,
  locating,
}: {
  getHome: GetHome;
  onShareLocation: () => void;
  locating: boolean;
}) {
  let copy: ReactNode;
  if (getHome.status === "no-location") {
    copy = (
      <>
        We need your position to find your nearest station.{" "}
        <button
          type="button"
          className="lastOrdersInlineAction"
          onClick={onShareLocation}
          disabled={locating}
          data-testid="last-orders-share-location"
        >
          {locating ? LOCATION_FINDING_LABEL : LOCATION_SHARE_LABEL["tonight-walk-and-last-train"]}
        </button>
      </>
    );
  } else if (getHome.status === "loading") {
    copy = "Looking up the last train from your nearest station.";
  } else if (getHome.status === "stale") {
    copy = "The last-train time we hold is out of date, so we show none. Check TfL before you set off.";
  } else if (getHome.status === "none") {
    copy = "We have no last-train time for this spot, so we show none. Check TfL before you set off.";
  } else {
    copy = (
      <>
        <span className="lastOrdersGetHomeStatus">{getHome.summary.statusLine}</span>{" "}
        <span>{getHome.summary.trainLine}</span>
      </>
    );
  }
  return (
    <div className="lastOrdersGetHome" data-testid="last-orders-get-home" data-status={getHome.status}>
      <TrainFront size={20} aria-hidden="true" className="lastOrdersGetHomeIcon" />
      <p className="lastOrdersGetHomeCopy">
        <span className="lastOrdersGetHomeLabel">Get home.</span> {copy}
      </p>
    </div>
  );
}

export default function TonightLastOrdersPanel({
  origin,
  near,
  onShareLocation,
  locating,
  onClose,
  focusOnOpen = false,
}: {
  origin: { lat: number; lng: number } | null;
  near: TonightNear | null;
  onShareLocation: () => void;
  locating: boolean;
  onClose: () => void;
  /** Opened by a tap: take focus to the heading, so it is not lost with the door. */
  focusOnOpen?: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnOpen) headingRef.current?.focus();
  }, [focusOnOpen]);
  const [packs, retry] = useLastOrdersPacks();
  const now = useLiveClock(TICK_MS);
  // Dark at night by default, unless the reader chose a theme (useNightDarkTheme).
  useNightDarkTheme(now !== null && isLastOrdersHour(now));
  const getHome = useTonightGetHome(origin, now);
  const from = near?.near ?? null;
  const fallback = getCity("london").mapView.center;
  const fromLat = from?.lat ?? fallback[1];
  const fromLng = from?.lng ?? fallback[0];

  const rows = useMemo(() => {
    if (packs.status !== "ready" || !now) return null;
    return rankLastOrders({
      pubs: packs.hours.pubs,
      prices: packs.prices,
      from: { lat: fromLat, lng: fromLng },
      now,
    });
  }, [packs, now, fromLat, fromLng]);

  const basis = origin
    ? "Walks are from where you are."
    : near?.patchLabel
      ? `Walks are from ${near.patchLabel}.`
      : "Walks are from central London. Share your location for walks from you.";
  const priceRead = rows ? oldestPintRead(rows.flatMap((row) => (row.price ? [row.price.observedAt] : []))) : null;

  return (
    <section
      id="last-orders"
      className="lastOrders tonightSection"
      aria-labelledby="last-orders-title"
      data-testid="last-orders"
    >
      <div className="lastOrdersHead">
        <h2 className="lastOrdersTitle tonightSectionTitle" id="last-orders-title" ref={headingRef} tabIndex={-1}>
          Last orders
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="lastOrdersClose"
          aria-label="Close Last orders"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </Button>
      </div>
      <p className="lastOrdersLede tonightSectionLine">
        Pubs whose listed hours run at least {LAST_ORDERS_MIN_MINUTES} more minutes. {LAST_ORDERS_ORDER_LINE}{" "}
        {basis}
      </p>

      <GetHomeLine getHome={getHome} onShareLocation={onShareLocation} locating={locating} />

      {packs.status === "failed" ? (
        <p className="lastOrdersStatus" role="status">
          We could not read the pub hours.{" "}
          <button type="button" className="lastOrdersInlineAction" onClick={retry}>
            Try again.
          </button>
        </p>
      ) : rows === null ? (
        <p className="lastOrdersStatus" role="status">
          Reading pub hours.
        </p>
      ) : rows.length === 0 ? (
        <p className="lastOrdersStatus" role="status" data-testid="last-orders-empty">
          No pub near here has listed hours that run another half hour. Pubs with no listed hours are left off, so
          one may still be open.
        </p>
      ) : (
        <RowList className="lastOrdersList" label="Pubs still open">
          {rows.map((row) => (
            <RowListItem
              key={row.venueId}
              className="lastOrdersRow"
              href={`/map?sel=${encodeURIComponent(row.venueId)}` as Route}
              title={row.name}
              meta={
                <>
                  <span className="lastOrdersFigure">{row.walkMinutes}</span> min walk
                  {row.closesAt ? (
                    <>
                      {" · "}
                      <span className="lastOrdersCloses">
                        closes <span className="lastOrdersFigure">{row.closesAt}</span>
                      </span>
                    </>
                  ) : null}
                </>
              }
              trailing={
                <span className="lastOrdersTrailing">
                  <Countdown row={row} />
                  {row.price ? (
                    <PintPriceBadge priceGbp={row.price.priceGbp} venueId={row.venueId} />
                  ) : (
                    <span className="lastOrdersNoPrice">No price yet</span>
                  )}
                </span>
              }
            />
          ))}
        </RowList>
      )}

      {rows && rows.length > 0 ? (
        <Link
          prefetch={false}
          href={`/map?${LAST_ORDERS_MAP_PARAM}=1` as Route}
          className="lastOrdersMapLink"
          data-testid="last-orders-map-link"
        >
          See every pub still open on the map
        </Link>
      ) : null}

      {packs.status === "ready" ? (
        <p className="lastOrdersSource">
          Hours from OpenStreetMap
          {packs.hours.readOn ? `, read ${formatObservedDate(new Date(packs.hours.readOn))}` : ""}. A pub can call
          time early, and a pub with no listed hours is left off.
          {priceRead ? ` Pint prices: ${formatSnapshotFrom(new Date(priceRead))}.` : ""}
        </p>
      ) : null}
    </section>
  );
}
