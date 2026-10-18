"use client";

import { formatPrice } from "@/lib/venues";
import type { RouteLegsSummary, RoutePace } from "@/lib/routeLegs";

type RouteMetricsProps = {
  summaryTotal: number | null;
  summaryDistance: number;
  legSummary: RouteLegsSummary;
  pace: RoutePace;
  journeyTotalMinutes: number | null;
  journeyLoading: boolean;
  routeLength: number;
  pricedStopCount: number;
  stopNoun: string;
  routeHeritageCount: number;
  routeWaterCount: number;
  routeWriterCount: number;
};

export default function RouteMetrics({
  summaryTotal,
  summaryDistance,
  legSummary,
  pace,
  journeyTotalMinutes,
  journeyLoading,
  routeLength,
  pricedStopCount,
  stopNoun,
  routeHeritageCount,
  routeWaterCount,
  routeWriterCount,
}: RouteMetricsProps) {
  return (
    <div className="routeMetrics">
      <div>
        <span className={summaryTotal === null ? "routeMetricsWord" : undefined}>
          {summaryTotal === null ? "Not recorded" : formatPrice(summaryTotal)}
        </span>
        <small>
          {summaryTotal === null
            ? "round total"
            : pricedStopCount < routeLength
              ? `known subtotal · ${pricedStopCount} of ${routeLength} stops priced`
              : "estimated round"}
        </small>
      </div>
      <div
        title="Straight-line distance between stops. The walk will be longer."
      >
        <span>{summaryDistance.toFixed(1)} km</span>
        <small>straight-line, between stops</small>
      </div>
      {legSummary.legs.length > 0 ? (
        <div
          title="Estimated at 4.8 km/h (walking) or 9 km/h (running), over the same straight-line distance. Real pavement time will be longer."
        >
          <span>{legSummary.totalMinutes} min</span>
          <small>{pace === "run" ? "running, straight-line" : "walking, straight-line"}</small>
        </div>
      ) : null}
      {typeof journeyTotalMinutes === "number" ? (
        <div title="Live TfL travel time between stops if you leave now, via CityMCP London.">
          <span>{Math.round(journeyTotalMinutes)} min</span>
          <small>TfL between stops</small>
        </div>
      ) : journeyLoading ? (
        <div>
          <span>…</span>
          <small>TfL loading</small>
        </div>
      ) : null}
      <div>
        <span>{routeLength}</span>
        <small>{routeLength === 1 ? stopNoun : `${stopNoun}s`}</small>
      </div>
      <div>
        <span>{routeHeritageCount}</span>
        <small>story pubs</small>
      </div>
      <div>
        <span>{routeWaterCount}</span>
        <small>by water</small>
      </div>
      <div>
        <span>{routeWriterCount}</span>
        <small>writer picks</small>
      </div>
    </div>
  );
}
