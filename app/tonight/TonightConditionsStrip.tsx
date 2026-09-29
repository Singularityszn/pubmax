"use client";

// Tonight Conditions strip: one calm line under the header with today's date, the
// cached weather's facts, the drink it calls for, and (once location is shared) a
// nearby venue claim. "Saturday 19 Jul. 18°C feels like, light cloud, 10% chance
// of rain, sunset 21:08, daylight. Beer garden weather. Lager or cider. 4 gardens
// near you with a pint under 6 quid." A stale reading prints its age instead of
// the drink and venue sentences.
//
// Mirrors TonightGetHomeStrip's idiom exactly: fetch fires in an effect, state
// only settles inside the async resolution/catch, an AbortController cancels on
// unmount or origin change. Tonight supplies the public reading at first paint;
// other hosts remain empty until their first response.
//
// Server does all the data work (weather snapshot + venue index) behind
// /api/tonight-conditions; this component only renders the strings it returns.
// Location is optional: with it, we send a rounded point for the "near you"
// claim; without it, the strip still shows the date, weather and drink line.

import { useEffect, useState } from "react";
import { CloudSun } from "lucide-react";

import { NO_WEATHER_READING_LINE } from "@/lib/conditionsFormat";
import { coarsenViewerPoint } from "@/lib/geo";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import type { TonightConditionsSummary } from "@/lib/tonightConditions";

import "./tonightConditions.css";

type Props = {
  origin?: { lat: number; lng: number } | null;
  initialSummary?: TonightConditionsSummary | null;
};

type ConditionsResponse = { summary: TonightConditionsSummary | null };

export default function TonightConditionsStrip({ origin, initialSummary }: Props) {
  const [summary, setSummary] = useState<TonightConditionsSummary | null | undefined>(initialSummary);

  const egressPoint = origin ? coarsenViewerPoint(origin) : null;
  const lat = egressPoint?.lat ?? null;
  const lng = egressPoint?.lng ?? null;

  useEffect(() => {
    const controller = new AbortController();
    if (initialSummary !== undefined && lat === null && lng === null) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) setSummary(initialSummary);
      });
    }
    const query = lat !== null && lng !== null ? `?lat=${lat}&lng=${lng}` : "";
    void loadSurfaceJson<ConditionsResponse>(
      `/api/tonight-conditions${query}`,
      {
        signal: controller.signal,
        validate: (body) => Boolean(body && "summary" in body),
      },
      (body, source) => {
        // The current server reading takes precedence over an older tab cache.
        // Location-specific snapshots still seed a deliberate location change.
        if (source === "snapshot" && initialSummary !== undefined && lat === null && lng === null) return;
        setSummary(body.summary ?? null);
      },
    );
    return () => controller.abort();
  }, [lat, lng, initialSummary]);

  if (summary === undefined) return null;

  if (summary === null) {
    return (
      <div className="tonightConditions" data-testid="tonight-conditions">
        <CloudSun size={16} aria-hidden="true" className="tonightConditionsIcon" />
        <p className="tonightConditionsCopy">{NO_WEATHER_READING_LINE}</p>
      </div>
    );
  }

  const trailer = summary.stale ? `${summary.checkedLabel}.` : summary.drinkLine;

  return (
    <div className="tonightConditions" data-testid="tonight-conditions">
      <CloudSun size={16} aria-hidden="true" className="tonightConditionsIcon" />
      <p className="tonightConditionsCopy">
        <span className="tonightConditionsLead">
          {summary.dateLabel}. {summary.factsLine}
        </span>
        {trailer ? (
          <>
            {" "}
            <span>{trailer}</span>
          </>
        ) : null}
        {summary.venueClaim ? (
          <>
            {" "}
            <span className="tonightConditionsVenues">{summary.venueClaim}.</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
