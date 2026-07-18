"use client";

// Tonight get-home strip — one calm line pair under the location block:
// "Victoria line good service." / "Last train from Oxford Circus 00:05."
//
// Reuses the existing /api/last-train surface (lib/tfl.ts, LastTrainCard's
// backend) rather than adding any new TfL plumbing. Renders NOTHING while
// loading, on error, or when there is nothing worth saying — the page must
// never gain a spinner or an apologetic empty card for an optional extra.
//
// React 19 rules: fetch fires in an effect, setState only inside the async
// resolution/catch, AbortController cancels on unmount/origin change.
// Privacy: coordinates are rounded to 3 decimals (~110 m) before they leave
// the device; enough to find the nearest station, not the drinker's doorstep.

import { useEffect, useState } from "react";
import { TrainFront } from "lucide-react";

import { summariseGetHome, type GetHomeSummary } from "@/lib/tonightGetHome";
import type { LastTrainResult } from "@/lib/tfl";

type Props = {
  origin: { lat: number; lng: number };
};

function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export default function TonightGetHomeStrip({ origin }: Props) {
  const [summary, setSummary] = useState<GetHomeSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const lat = roundCoord(origin.lat);
    const lng = roundCoord(origin.lng);
    fetch(`/api/last-train?lat=${lat}&lng=${lng}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: LastTrainResult | null) => {
        if (controller.signal.aborted) return;
        setSummary(body ? summariseGetHome(body) : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSummary(null);
      });
    return () => controller.abort();
  }, [origin.lat, origin.lng]);

  if (!summary) return null;

  return (
    <div className="tonightGetHome" data-testid="tonight-get-home">
      <TrainFront size={15} aria-hidden="true" className="tonightGetHomeIcon" />
      <p className="tonightGetHomeCopy">
        <span className="tonightGetHomeStatus">{summary.statusLine}</span>{" "}
        <span>{summary.trainLine}</span>
      </p>
    </div>
  );
}
