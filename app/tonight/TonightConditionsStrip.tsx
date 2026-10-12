"use client";

// Tonight Conditions strip: one calm line with today's date, the
// cached weather's facts, the drink it calls for, and (once location is shared) a
// nearby venue claim. "Saturday 19 Jul. 18°C feels like, light cloud, 10% chance
// of rain, sunset 21:08, daylight. Beer garden weather. Lager or cider. 4 gardens
// near you with a pint under 6 quid." A stale reading prints its age instead of
// the drink and venue sentences.
//
// Mirrors TonightGetHomeStrip's idiom: fetch fires in an effect, state only
// settles inside the async resolution, and an AbortController cancels on unmount
// or origin change. No spinner, no empty card.
//
// ON TONIGHT THE STRIP HOLDS ITS OWN ROOM WHILE IT LOADS. A strip that mounts
// only after its read completes would shift the content below it.
// While the read runs it paints an invisible
// panel of the same box, sized in lines to the width it has (tonightConditions.css),
// and the answer fills it. A read that fails says there is no reading, the same
// line a reading-less answer gets, inside the same held room, so the room is
// never left blank and nothing below it moves. Every other host (the feed's
// desktop rail) renders nothing while loading or on a failed read.
//
// Server does all the data work (weather snapshot + venue index) behind
// /api/tonight-conditions; this component only renders the strings it returns.
// Location is optional: with it, we send a rounded point for the "near you"
// claim; without it, the strip still shows the date, weather and drink line.

import { useEffect, useState } from "react";
import { CloudSun } from "lucide-react";

import { NO_WEATHER_READING_LINE } from "@/lib/conditionsFormat";
import { tonightDayPart } from "@/lib/daySlot";
import { drinkWeatherLine } from "@/lib/drinkWeather";
import { coarsenViewerPoint } from "@/lib/geo";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import type { TonightConditionsSummary } from "@/lib/tonightConditions";

import "./tonightConditions.css";

type Props = {
  origin?: { lat: number; lng: number } | null;
  /**
   * Hosted on Tonight. Its drink line names tonight rather than the clock's
   * part of the day. It reserves space while the read runs or fails. The
   * summary stays the clock's for every other surface that reads it.
   */
  tonightMode?: boolean;
};

type ConditionsResponse = { summary: TonightConditionsSummary | null };

export default function TonightConditionsStrip({ origin, tonightMode = false }: Props) {
  const [summary, setSummary] = useState<TonightConditionsSummary | null | undefined>(undefined);

  const egressPoint = origin ? coarsenViewerPoint(origin) : null;
  const lat = egressPoint?.lat ?? null;
  const lng = egressPoint?.lng ?? null;

  useEffect(() => {
    const controller = new AbortController();
    const query = lat !== null && lng !== null ? `?lat=${lat}&lng=${lng}` : "";
    void loadSurfaceJson<ConditionsResponse>(
      `/api/tonight-conditions${query}`,
      {
        signal: controller.signal,
        validate: (body) => Boolean(body && "summary" in body),
      },
      (body) => setSummary(body.summary ?? null),
    ).then((applied) => {
      // A failed first read has nothing to show, so it settles on the
      // no-reading line. A failed refresh keeps the reading already shown.
      if (tonightMode && applied === "failed" && !controller.signal.aborted) {
        setSummary((held) => (held === undefined ? null : held));
      }
    });
    return () => controller.abort();
  }, [lat, lng, tonightMode]);

  if (summary === undefined) {
    if (!tonightMode) return null;
    return (
      <div
        className="tonightConditions tonightConditionsRoom tonightConditionsHold"
        aria-hidden="true"
      >
        <CloudSun size={16} aria-hidden="true" className="tonightConditionsIcon" />
        <p className="tonightConditionsCopy" />
      </div>
    );
  }

  if (summary === null) {
    return (
      <div
        className={tonightMode ? "tonightConditions tonightConditionsRoom" : "tonightConditions"}
        data-testid="tonight-conditions"
      >
        <CloudSun size={16} aria-hidden="true" className="tonightConditionsIcon" />
        <p className="tonightConditionsCopy">{NO_WEATHER_READING_LINE}</p>
      </div>
    );
  }

  const drinkLine =
    tonightMode && summary.drinkRuleId
      ? (drinkWeatherLine(summary.drinkRuleId, tonightDayPart(new Date())) ?? summary.drinkLine)
      : summary.drinkLine;
  const trailer = summary.stale ? `${summary.checkedLabel}.` : drinkLine;

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
