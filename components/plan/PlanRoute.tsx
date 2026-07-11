"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";

type RouteStop = { venueId: string; venueName: string; position: number };

type BusynessSignal = {
  level: "quiet" | "moderate" | "busy" | "rammed";
  label: string;
  source: "typical-pattern" | "community-report";
  isOpen: boolean | "unknown";
  explanation: string;
};
type GetInSignal = {
  fit: "likely" | "uncertain" | "unlikely" | "book-ahead";
  label: string;
  reason: string;
};
type BookingSignal = { available: boolean; label: string; href: string | null };
type StopSignal = {
  position: number;
  venueId: string;
  venueName: string;
  busyness: BusynessSignal | null;
  getIn: GetInSignal;
  booking: BookingSignal;
};
type GetInReport = { groupSize: number; generatedAt: string; stops: StopSignal[] };

type FetchState = "loading" | "ready" | "unavailable";

export default function PlanRoute({ planId, stops }: { planId: string; stops: RouteStop[] }) {
  const [report, setReport] = useState<GetInReport | null>(null);
  const [state, setState] = useState<FetchState>("loading");

  useEffect(() => {
    let active = true;
    fetch(`/api/plans/${planId}/getin`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((body: GetInReport) => {
        if (!active) return;
        setReport(body && Array.isArray(body.stops) ? body : null);
        setState(body && Array.isArray(body.stops) ? "ready" : "unavailable");
      })
      .catch(() => {
        if (active) setState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [planId]);

  const signals = new Map((report?.stops ?? []).map((stop) => [stop.venueId, stop]));
  const groupSize = report?.groupSize ?? 0;

  return (
    <div className="planRoute">
      {state === "ready" && groupSize > 0 ? (
        <p className="planRoute__basis">
          Get-in estimate for {groupSize === 1 ? "one" : groupSize} going. Never a guarantee of entry.
        </p>
      ) : null}
      <ol className="planSummary__stops">
        {stops.map((stop, index) => {
          const signal = signals.get(stop.venueId);
          return (
            <li key={`${stop.position}-${stop.venueId}`} style={{ "--i": index } as CSSProperties}>
              <span className="planSummary__marker">{index + 1}</span>
              <div className="planRoute__body">
                <strong>{stop.venueName}</strong>
                <Link href={`/map?venue=${encodeURIComponent(stop.venueId)}`}>Open on the map</Link>
                <StopGetIn state={state} signal={signal} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StopGetIn({ state, signal }: { state: FetchState; signal: StopSignal | undefined }) {
  if (state === "loading") {
    return <span className="planRoute__signal planRoute__signal--loading" aria-hidden="true" />;
  }
  if (state === "unavailable" || !signal) return null;

  const { busyness, getIn, booking } = signal;
  const closed = busyness?.isOpen === false;

  return (
    <div className="planRoute__signal" data-fit={getIn.fit}>
      {busyness ? (
        <span className="planRoute__busy" title={busyness.explanation}>
          <span className="planRoute__dot" data-level={busyness.level} aria-hidden="true" />
          {closed ? "Likely closed now" : busyness.label}
        </span>
      ) : null}
      <span className="planRoute__fit" title={getIn.reason}>
        {getIn.label}
      </span>
      {booking.available && booking.href ? (
        <a
          className="planRoute__book"
          href={booking.href}
          target="_blank"
          rel="noreferrer noopener"
        >
          {booking.label}
        </a>
      ) : null}
    </div>
  );
}
