"use client";

// The pub sheet's Sun Chaser line, loaded only while Sun Chaser is on
// (SunChaserVenueLine.tsx). Nothing at all until the map layer holds an
// answer for this pub, so the sheet never waits on it.

import { SUN_ESTIMATE_CAVEAT, segmentAt, sunHeadline, sunSkyNote } from "@/lib/sunChaser";
import { sunChaserSelectedTime, useSunChaser } from "./sunChaserStore";

export default function SunChaserVenueLineBody({ venueId }: { venueId: string }) {
  const state = useSunChaser();
  const estimate = state.enabled ? state.estimates.get(venueId) : undefined;
  const at = sunChaserSelectedTime(state);
  if (!estimate || !at) return null;
  const isNow = state.offsetSteps === 0;
  const segment = estimate.kind === "estimate" ? segmentAt(estimate.timeline, at) : null;
  const sky = sunSkyNote(segment?.state ?? "unknown", isNow, state.skyCondition);
  return (
    <p className="sunChaserVenueLine" data-sun-state={segment?.state ?? "none"}>
      <strong>{sunHeadline(estimate, at, isNow)}</strong>
      {sky ? <> {sky}</> : null}
      {estimate.kind === "estimate" ? <span> ({SUN_ESTIMATE_CAVEAT.charAt(0).toLowerCase()}{SUN_ESTIMATE_CAVEAT.slice(1, -1)})</span> : null}
    </p>
  );
}
