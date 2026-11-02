"use client";

// THE LAST ORDERS BELL (wild idea 07). When a pub's sourced hours say it
// closes within 45 minutes, a brass bell swings once and a card says so: when
// it closes, where the hours came from, and a pub a short walk away that the
// same hours say is open later. It rings for no pub whose hours we do not hold
// (lib/wildLastOrdersBell.ts, over lib/lastOrders.ts).
//
// It reads Tonight's own hours pack through the shared surface cache, so the
// map and Tonight and this card read one file. `?wildclock=HH:MM` sets London's
// clock for the check, so the bell can be seen at 22:40 at any hour; only the
// wild switch reads it, because this component loads only behind the switch
// (components/wild/LastOrdersBellSlot.tsx).

import type { Route } from "next";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { formatObservedDate } from "@/lib/dataFreshness";
import { LAST_ORDERS_HOURS_PATH, parseLastOrdersHoursPack, type LastOrdersHoursPack } from "@/lib/lastOrdersList";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import { useLiveClock } from "@/lib/useLiveClock";
import { lastOrdersBell, wildClockFromSearch, type LastOrdersBellAnswer } from "@/lib/wildLastOrdersBell";
import { prefersReducedMotion } from "@/lib/wildMode";

import "./lastOrdersBell.css";

export type LastOrdersBellProps = {
  venueId: string;
  venueName: string;
  lat?: number | null;
  lng?: number | null;
  /** "page" is the full card; "sheet" is the venue sheet's compact row. */
  variant?: "page" | "sheet";
};

const TICK_MS = 30_000;
const RING_SECONDS = 2.2;

function useHoursPack(): LastOrdersHoursPack | null {
  const [pack, setPack] = useState<LastOrdersHoursPack | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadSurfaceJson<unknown>(
      LAST_ORDERS_HOURS_PATH,
      { signal: controller.signal, validate: (body) => parseLastOrdersHoursPack(body) !== null },
      (body) => {
        const parsed = parseLastOrdersHoursPack(body);
        if (parsed && !controller.signal.aborted) setPack(parsed);
      },
    );
    return () => controller.abort();
  }, []);
  return pack;
}

/** One damped swing of the bell, with the clapper a beat behind it. */
function useBellSwing() {
  const bellRef = useRef<SVGGElement | null>(null);
  const clapperRef = useRef<SVGGElement | null>(null);
  const frame = useRef(0);

  const ring = useCallback(() => {
    if (prefersReducedMotion()) return;
    if (frame.current) window.cancelAnimationFrame(frame.current);
    const start = performance.now();
    const angleAt = (t: number) => (t <= 0 ? 0 : 26 * Math.exp(-2.3 * t) * Math.sin(2 * Math.PI * 1.6 * t));
    const step = (now: number) => {
      const t = (now - start) / 1000;
      const done = t >= RING_SECONDS;
      const bell = done ? 0 : angleAt(t);
      const clapper = done ? 0 : -0.7 * angleAt(t - 0.07);
      if (bellRef.current) bellRef.current.style.transform = `rotate(${bell.toFixed(2)}deg)`;
      if (clapperRef.current) clapperRef.current.style.transform = `rotate(${clapper.toFixed(2)}deg)`;
      frame.current = done ? 0 : window.requestAnimationFrame(step);
    };
    frame.current = window.requestAnimationFrame(step);
  }, []);

  useEffect(
    () => () => {
      if (frame.current) window.cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );

  return { bellRef, clapperRef, ring };
}

function BrassBell({
  bellRef,
  clapperRef,
}: {
  bellRef: React.MutableRefObject<SVGGElement | null>;
  clapperRef: React.MutableRefObject<SVGGElement | null>;
}) {
  const brass = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-brass`;
  return (
    <svg className="lastOrdersBell__bell" viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id={brass} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="lastOrdersBell__brassDark" />
          <stop offset="0.38" className="lastOrdersBell__brassLight" />
          <stop offset="0.62" className="lastOrdersBell__brass" />
          <stop offset="1" className="lastOrdersBell__brassDark" />
        </linearGradient>
      </defs>
      <rect className="lastOrdersBell__yoke" x="17" y="1.5" width="14" height="4.5" rx="2" />
      <g className="lastOrdersBell__swing" ref={bellRef}>
        <path className="lastOrdersBell__crown" d="M21.5 5.5h5v4h-5z" />
        <g className="lastOrdersBell__clapperSwing" ref={clapperRef}>
          <path className="lastOrdersBell__clapperRod" d="M24 26v11" />
          <circle className="lastOrdersBell__clapper" cx="24" cy="39.5" r="3.6" />
        </g>
        <path
          d="M24 8.5c-8.1 0-12.7 6.3-12.7 13.9v7.2L7.6 35.4c-.5.8.1 1.8 1 1.8h30.8c.9 0 1.5-1 1-1.8l-3.7-5.8v-7.2C36.7 14.8 32.1 8.5 24 8.5z"
          fill={`url(#${brass})`}
        />
        <path className="lastOrdersBell__lip" d="M8.4 34.6h31.2" />
        <path className="lastOrdersBell__shine" d="M16.4 27.5v-5.2c0-4.1 2-7.6 5.4-8.9" />
      </g>
    </svg>
  );
}

export default function LastOrdersBell({ venueId, venueName, lat = null, lng = null, variant = "page" }: LastOrdersBellProps) {
  const pack = useHoursPack();
  // The address's clock, read once. Only the wild switch ever mounts this.
  const [pinned] = useState<Date | null>(() =>
    typeof window === "undefined" ? null : wildClockFromSearch(window.location.search, new Date()),
  );
  const live = useLiveClock(TICK_MS, pinned === null);
  const now = pinned ?? live;
  const answer = useMemo(
    () => (pack && now ? lastOrdersBell({ pubs: pack.pubs, pub: { venueId, name: venueName, lat, lng }, now }) : null),
    [pack, now, venueId, venueName, lat, lng],
  );
  if (!answer || !pack) return null;
  return <LastOrdersBellCard answer={answer} venueName={venueName} readOn={pack.readOn} variant={variant} />;
}

/** The card itself: the bell, the close, the pub open later and the source. */
export function LastOrdersBellCard({
  answer,
  venueName,
  readOn: readOnDay,
  variant = "page",
}: {
  answer: LastOrdersBellAnswer;
  venueName: string;
  /** The day the hours were read, YYYY-MM-DD, or null. */
  readOn: string | null;
  variant?: "page" | "sheet";
}) {
  const { bellRef, clapperRef, ring } = useBellSwing();
  const rungFor = useRef<string | null>(null);
  const ringKey = `${answer.venueId}@${answer.closesAt}`;

  // It rings ONCE when it appears, and again only when tapped.
  useEffect(() => {
    if (rungFor.current === ringKey) return;
    rungFor.current = ringKey;
    ring();
  }, [ringKey, ring]);

  const readOn = readOnDay ? formatObservedDate(new Date(`${readOnDay}T12:00:00Z`)) : null;
  const source = `Hours from OpenStreetMap${readOn ? `, read ${readOn}` : ""}.`;
  const nearby = answer.nearby;
  const nearbyHref = nearby ? (`/map?sel=${encodeURIComponent(nearby.venueId)}` as Route) : null;
  const minutesWord = answer.minutesLeft === 1 ? "minute" : "minutes";

  return (
    <section
      className={`lastOrdersBell lastOrdersBell--${variant}`}
      aria-label={`Last orders at ${venueName}`}
      data-wild-bell=""
    >
      <button type="button" className="lastOrdersBell__ring" onClick={ring} aria-label="Ring the bell again">
        <BrassBell bellRef={bellRef} clapperRef={clapperRef} />
      </button>
      <div className="lastOrdersBell__body">
        <p className="lastOrdersBell__title" role="status">
          Last orders soon at {venueName}.
        </p>
        <p className="lastOrdersBell__line">
          It closes at <time className="lastOrdersBell__figure">{answer.closesAt}</time> {answer.when}
          {variant === "page" ? (
            <>
              , <span className="lastOrdersBell__figure">{answer.minutesLeft}</span> {minutesWord} from now.
            </>
          ) : (
            "."
          )}
        </p>
        {nearby && nearbyHref ? (
          <p className="lastOrdersBell__nearby">
            Open later nearby:{" "}
            <Link prefetch={false} href={nearbyHref} className="lastOrdersBell__link">
              {nearby.name}
            </Link>
            {nearby.closesAt ? (
              <>
                , until <time className="lastOrdersBell__figure">{nearby.closesAt}</time>
              </>
            ) : (
              ", open all night"
            )}
            {variant === "page" ? (
              <>
                . A <span className="lastOrdersBell__figure">{nearby.walkMinutes}</span> min walk.
              </>
            ) : (
              "."
            )}
          </p>
        ) : null}
        <p className="lastOrdersBell__source">
          {source}
          {variant === "page" ? " A pub can call time early." : ""}
        </p>
      </div>
    </section>
  );
}
