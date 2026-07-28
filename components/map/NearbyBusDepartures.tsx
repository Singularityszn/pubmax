"use client";

import { useEffect, useState } from "react";

import {
  busDeparturesFreshness,
  departureDueMinutes,
  shouldPollBusDepartures,
  startBusDeparturesPoll,
  type BusDirection,
  type NearbyBusDeparturesResult,
} from "@/lib/nearbyBusDepartures";

import "./nearbyBusDepartures.css";

type LoadState =
  | { status: "idle" }
  | { status: "loaded"; result: NearbyBusDeparturesResult };

export function nearbyBusDeparturesFetchUrl(lat: number, lng: number): string {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
  });
  return `/api/nearby-bus-departures?${params.toString()}`;
}

function directedDestination(
  direction: BusDirection,
  destinationName: string,
): string {
  if (!direction) return `To ${destinationName}`;
  return `${direction[0].toUpperCase()}${direction.slice(1)} to ${destinationName}`;
}

function dueLabel(minutes: number | null): string {
  if (minutes === null) return "Time not known";
  if (minutes <= 0) return "Due";
  return `${minutes} min`;
}

function clockLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "Time not known";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

function checkedAgo(ageMinutes: number | null): string {
  if (ageMinutes === null) return "";
  if (ageMinutes <= 1) return "Checked about a minute ago.";
  return `Checked about ${ageMinutes} minutes ago.`;
}

export function NearbyBusDeparturesView({
  result,
  now,
}: {
  result: NearbyBusDeparturesResult;
  now: Date;
}) {
  if (result.status === "unavailable") {
    return (
      <p className="nearbyBusDeparturesNote" role="status">
        Couldn&apos;t check nearby buses just now. Check TfL or the stop display
        before you set off.
      </p>
    );
  }

  const freshness = busDeparturesFreshness(result.generatedAt, now);
  const outOfDate = freshness.state === "out-of-date";

  return (
    <>
      {freshness.state === "ageing" ? (
        <p className="nearbyBusDeparturesNote nearbyBusFreshness" role="status">
          {checkedAgo(freshness.ageMinutes)}
        </p>
      ) : null}
      {outOfDate ? (
        <p className="nearbyBusDeparturesNote nearbyBusFreshness" role="status">
          These times are out of date. {checkedAgo(freshness.ageMinutes)} They
          are what was predicted then, so check the stop display before you set
          off.
        </p>
      ) : null}
      <ol className="nearbyBusStopList">
        {result.stops.map((stop) => {
          const stopDirection = [
            stop.indicator,
            stop.towards ? `towards ${stop.towards}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li className="nearbyBusStop" key={stop.id}>
              <div className="nearbyBusStopHeader">
                <span className="nearbyBusStopIdentity">
                  <strong>{stop.name}</strong>
                  {stopDirection ? <span>{stopDirection}</span> : null}
                </span>
                <span className="nearbyBusDistance">
                  {stop.distanceM} m from here, straight line
                </span>
              </div>
              <ol className="nearbyBusDepartureList">
                {stop.departures.map((departure) => (
                  <li
                    className="nearbyBusDeparture"
                    key={`${departure.lineName}:${departure.expectedArrival}:${departure.destinationName}`}
                  >
                    <strong className="nearbyBusLine">
                      {departure.lineName}
                    </strong>
                    <span className="nearbyBusDestination">
                      {directedDestination(
                        departure.direction,
                        departure.destinationName,
                      )}
                    </span>
                    <time
                      className="nearbyBusDue"
                      dateTime={departure.expectedArrival}
                    >
                      {outOfDate
                        ? clockLabel(departure.expectedArrival)
                        : dueLabel(
                            departureDueMinutes(departure.expectedArrival, now),
                          )}
                    </time>
                  </li>
                ))}
              </ol>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function isResult(value: unknown): value is NearbyBusDeparturesResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<NearbyBusDeparturesResult>;
  return (
    (result.status === "ready" || result.status === "unavailable") &&
    Array.isArray(result.stops) &&
    typeof result.generatedAt === "string"
  );
}

function unavailableResult(): NearbyBusDeparturesResult {
  return {
    status: "unavailable",
    stops: [],
    generatedAt: new Date().toISOString(),
  };
}

export default function NearbyBusDepartures({
  lat,
  lng,
}: {
  lat: number;
  lng: number;
}) {
  const [open, setOpen] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const sync = () => {
      const visible = document.visibilityState === "visible";
      // Coming back to the page means the clock we last rendered against is as
      // old as the time away, so restart it before anything is read off it.
      if (visible) setNowMs(Date.now());
      setDocumentVisible(visible);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const polling = shouldPollBusDepartures({ open, documentVisible });

  useEffect(() => {
    if (!polling) return;

    return startBusDeparturesPoll({
      onTick: setNowMs,
      load: (signal) =>
        fetch(nearbyBusDeparturesFetchUrl(lat, lng), { signal })
          .then((response) => {
            if (!response.ok) throw new Error(String(response.status));
            return response.json() as Promise<unknown>;
          })
          .then((result) => {
            if (signal.aborted) return;
            setNowMs(Date.now());
            setState({
              status: "loaded",
              result: isResult(result) ? result : unavailableResult(),
            });
          })
          .catch((error: unknown) => {
            if (
              signal.aborted ||
              (error instanceof Error && error.name === "AbortError")
            ) {
              return;
            }
            // A failed refresh never erases departures we already hold: they
            // keep ageing in view and say so, which is more use than a blank.
            setState((prev) =>
              prev.status === "loaded" && prev.result.status === "ready"
                ? prev
                : { status: "loaded", result: unavailableResult() },
            );
          }),
    });
  }, [lat, lng, polling]);

  return (
    <details
      className="nearbyBusDepartures"
      onToggle={(event) => {
        const nowOpen = event.currentTarget.open;
        if (nowOpen) setNowMs(Date.now());
        setOpen(nowOpen);
      }}
    >
      <summary className="nearbyBusDeparturesSummary">
        <span>
          <strong>Buses nearby</strong>
          <small>Live TfL departures from stops near here</small>
        </span>
      </summary>
      <div className="nearbyBusDeparturesBody">
        {polling && state.status === "idle" ? (
          <p className="nearbyBusDeparturesNote" role="status">
            Checking live departures…
          </p>
        ) : null}
        {state.status === "loaded" ? (
          <NearbyBusDeparturesView
            result={state.result}
            now={new Date(nowMs)}
          />
        ) : null}
      </div>
    </details>
  );
}
