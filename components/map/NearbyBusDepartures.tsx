"use client";

import { useEffect, useRef, useState } from "react";

import type {
  BusDirection,
  NearbyBusDeparturesResult,
} from "@/lib/nearbyBusDepartures";

import "./nearbyBusDepartures.css";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
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

function dueLabel(minutes: number): string {
  return `${minutes} min`;
}

export function NearbyBusDeparturesView({
  result,
}: {
  result: NearbyBusDeparturesResult;
}) {
  if (result.status === "unavailable") {
    return (
      <p className="nearbyBusDeparturesNote" role="status">
        Couldn&apos;t check nearby buses just now. Check TfL or the stop display
        before you set off.
      </p>
    );
  }

  return (
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
                {stop.distanceM} m from pub, straight line
              </span>
            </div>
            <ol className="nearbyBusDepartureList">
              {stop.departures.map((departure) => (
                <li
                  className="nearbyBusDeparture"
                  key={`${departure.lineName}:${departure.expectedArrival}:${departure.destinationName}`}
                >
                  <strong className="nearbyBusLine">{departure.lineName}</strong>
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
                    {dueLabel(departure.dueMinutes)}
                  </time>
                </li>
              ))}
            </ol>
          </li>
        );
      })}
    </ol>
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
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = controllerRef;
    return () => controller.current?.abort();
  }, []);

  function loadOnOpen(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || state.status !== "idle") return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "loading" });
    fetch(nearbyBusDeparturesFetchUrl(lat, lng), {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<unknown>;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setState(
            isResult(result)
              ? { status: "loaded", result }
              : { status: "loaded", result: unavailableResult() },
          );
        }
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return;
        }
        setState({
          status: "loaded",
          result: unavailableResult(),
        });
      });
  }

  return (
    <details className="nearbyBusDepartures" onToggle={loadOnOpen}>
      <summary className="nearbyBusDeparturesSummary">
        <span>
          <strong>Buses nearby</strong>
          <small>Live TfL departures from stops near this pub</small>
        </span>
      </summary>
      <div className="nearbyBusDeparturesBody" aria-live="polite">
        {state.status === "loading" ? (
          <p className="nearbyBusDeparturesNote">Checking live departures…</p>
        ) : null}
        {state.status === "loaded" ? (
          <NearbyBusDeparturesView result={state.result} />
        ) : null}
      </div>
    </details>
  );
}
