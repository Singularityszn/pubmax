"use client";

import { useEffect, useRef, useState } from "react";

import {
  BUS_DEPARTURES_SLOW_WAIT_MS,
  busDeparturesFreshness,
  departureDueMinutes,
  shouldPollBusDepartures,
  startBusDeparturesPoll,
  type BusDeparturesPoll,
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

function count(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}

export const BUS_DEPARTURES_UNAVAILABLE_COPY =
  "Couldn't check nearby buses just now.";

/**
 * The one thing said out loud, and it is said about the load, not about the
 * clock: nothing here re-words as minutes tick, so a screen reader is told once
 * that departures arrived rather than every time a countdown changes.
 */
export function busDeparturesAnnouncement(input: {
  polling: boolean;
  result: NearbyBusDeparturesResult | null;
  waitedTooLong: boolean;
}): string {
  if (input.result) {
    if (input.result.status === "unavailable") {
      return BUS_DEPARTURES_UNAVAILABLE_COPY;
    }
    const departures = input.result.stops.reduce(
      (total, stop) => total + stop.departures.length,
      0,
    );
    return `${count(input.result.stops.length, "stop")}, ${count(departures, "departure")} nearby.`;
  }
  if (!input.polling) return "";
  return input.waitedTooLong
    ? BUS_DEPARTURES_UNAVAILABLE_COPY
    : "Checking live departures.";
}

/** A check the reader can start again is only worth offering once one failed. */
export function shouldOfferBusRetry(input: {
  polling: boolean;
  result: NearbyBusDeparturesResult | null;
  waitedTooLong: boolean;
}): boolean {
  if (input.result) return input.result.status === "unavailable";
  return input.polling && input.waitedTooLong;
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
      <p className="nearbyBusDeparturesNote">
        {BUS_DEPARTURES_UNAVAILABLE_COPY} Check TfL or the stop display before
        you set off.
      </p>
    );
  }

  const freshness = busDeparturesFreshness(result.generatedAt, now);
  const outOfDate = freshness.state === "out-of-date";

  return (
    <>
      {freshness.state === "ageing" ? (
        <p className="nearbyBusDeparturesNote nearbyBusFreshness">
          {checkedAgo(freshness.ageMinutes)}
        </p>
      ) : null}
      {outOfDate ? (
        <p className="nearbyBusDeparturesNote nearbyBusFreshness">
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
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  const [waitAttempt, setWaitAttempt] = useState(0);
  const lastLoadAtRef = useRef<number | null>(null);
  const pollRef = useRef<BusDeparturesPoll | null>(null);

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

    const poll = startBusDeparturesPoll({
      onTick: setNowMs,
      lastLoadAt: lastLoadAtRef.current,
      onLoadStart: (at) => {
        lastLoadAtRef.current = at;
      },
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

    pollRef.current = poll;
    return () => {
      pollRef.current = null;
      poll.stop();
    };
  }, [lat, lng, polling]);

  // The card stops promising a result long before the route's own budget runs
  // out, but the request underneath keeps going: a slow TfL that answers still
  // fills the card in.
  const waitingForFirst = polling && state.status === "idle";
  useEffect(() => {
    if (!waitingForFirst) return;
    const timer = setTimeout(
      () => setWaitedTooLong(true),
      BUS_DEPARTURES_SLOW_WAIT_MS,
    );
    return () => clearTimeout(timer);
  }, [waitingForFirst, waitAttempt]);

  const result = state.status === "loaded" ? state.result : null;
  const announcement = busDeparturesAnnouncement({
    polling,
    result,
    waitedTooLong,
  });
  const offerRetry = shouldOfferBusRetry({ polling, result, waitedTooLong });

  function retry() {
    setWaitedTooLong(false);
    setWaitAttempt((attempt) => attempt + 1);
    pollRef.current?.refresh();
  }

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
        <p className="nearbyBusAnnouncement" role="status">
          {announcement}
        </p>
        {waitingForFirst && !waitedTooLong ? (
          <p className="nearbyBusDeparturesNote">Checking live departures…</p>
        ) : null}
        {waitingForFirst && waitedTooLong ? (
          <p className="nearbyBusDeparturesNote">
            {BUS_DEPARTURES_UNAVAILABLE_COPY} The check is still running, so
            this may fill in on its own.
          </p>
        ) : null}
        {result ? (
          <NearbyBusDeparturesView result={result} now={new Date(nowMs)} />
        ) : null}
        {offerRetry ? (
          <button type="button" className="nearbyBusRetry" onClick={retry}>
            Check again
          </button>
        ) : null}
      </div>
    </details>
  );
}
