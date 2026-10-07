"use client";

// Compact Tonight Conditions chip for the desktop map toolbar. The owner wants
// the weather verdict ALWAYS visible; the map page cannot host the full right
// rail (the venue drawer owns the right edge), so the map carries this chip in
// the toolbar row instead: the facts line, then the verdict's first sentence
// ("18°C feels like, light cloud, 10% chance of rain, 12 km/h wind, sunset
// 21:08, daylight. Warm and dry."), or the reading's age in place of a verdict
// when it is stale.
//
// Same idiom as every fail-soft strip: fetch in an effect, AbortController on
// unmount, renders NOTHING while loading or on error, and says so plainly when
// the server has no reading for the area. The full drink line rides the
// title/aria text.

import { useEffect, useState } from "react";
import { CloudSun } from "lucide-react";

import type { TonightConditionsSummary } from "@/lib/tonightConditions";
import { NO_WEATHER_READING_LINE, shortDrinkVerdict } from "@/lib/conditionsFormat";
import { loadSurfaceJson, SURFACE_JUST_READ_MS } from "@/lib/surfaceDataCache";

import "./conditionsChip.css";

type ConditionsResponse = { summary: TonightConditionsSummary | null };

export default function ConditionsChip() {
  const [summary, setSummary] = useState<TonightConditionsSummary | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    void loadSurfaceJson<ConditionsResponse>(
      "/api/tonight-conditions",
      {
        signal: controller.signal,
        validate: (body) => Boolean(body && "summary" in body),
        freshForMs: SURFACE_JUST_READ_MS,
      },
      (body) => setSummary(body.summary ?? null),
    ).then((outcome) => {
      if (outcome === "failed" && !controller.signal.aborted) setSummary(undefined);
    });
    return () => controller.abort();
  }, []);

  if (summary === undefined) return null;

  if (summary === null) {
    return (
      <span className="conditionsChip">
        <CloudSun size={14} aria-hidden="true" />
        <span className="conditionsChipText">{NO_WEATHER_READING_LINE}</span>
      </span>
    );
  }

  const trailer = summary.stale ? `${summary.checkedLabel}.` : summary.drinkLine;
  const verdict = summary.stale ? trailer : shortDrinkVerdict(summary.drinkLine);
  const full = [`${summary.dateLabel}.`, summary.factsLine, trailer].filter(Boolean).join(" ");

  return (
    <span className="conditionsChip" title={full} aria-label={full}>
      <CloudSun size={14} aria-hidden="true" />
      <span className="conditionsChipText">
        <span className="conditionsChipWeather">{summary.factsLine}</span>
        {verdict ? (
          <>
            {" "}
            <span className="conditionsChipVerdict">{verdict}</span>
          </>
        ) : null}
      </span>
    </span>
  );
}
