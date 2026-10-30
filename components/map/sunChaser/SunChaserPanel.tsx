"use client";

// The Sun Chaser time slider and status line. Loaded only after the chip is
// on (SunChaserControls.tsx), because it carries the sun maths.

import { useEffect } from "react";
import {
  formatSunClock,
  segmentAt,
  SUN_CHASER_HORIZON_MINUTES,
  SUN_CHASER_STEP_MINUTES,
  SUN_ESTIMATE_CAVEAT,
  sunSkyNote,
} from "@/lib/sunChaser";
import { sunChaserSelectedTime, updateSunChaser, useSunChaser, type SunChaserState } from "./sunChaserStore";

const MAX_STEPS = SUN_CHASER_HORIZON_MINUTES / SUN_CHASER_STEP_MINUTES;

function statusLine(state: SunChaserState): string {
  if (state.status === "zoom-in") return "Zoom in to street level to see which gardens are in the sun.";
  if (state.status === "no-buildings") return "No sun estimate: no building heights loaded here.";
  const at = sunChaserSelectedTime(state);
  if (state.status !== "ready" || !at) return "Working out the sun for gardens in view.";
  let gardens = 0;
  let inSun = 0;
  for (const estimate of state.estimates.values()) {
    if (estimate.kind !== "estimate") continue;
    gardens += 1;
    if (segmentAt(estimate.timeline, at)?.state === "sun") inSun += 1;
  }
  if (gardens === 0) return "No sun estimates for the gardens in view yet.";
  const when = state.offsetSteps === 0 ? "now" : `at ${formatSunClock(at, "exact")}`;
  const line = `${inSun} of ${gardens} recorded ${gardens === 1 ? "garden" : "gardens"} in view likely in the sun ${when}.`;
  const sky = sunSkyNote(inSun > 0 ? "sun" : "shade", state.offsetSteps === 0, state.sky, state.skyFetchedAtMs);
  return sky ? `${line} ${sky.replace("Sunny spot", "Sunny spots")}` : line;
}

/**
 * While a finger or pointer holds the slider, the page is marked so the phone
 * Filters sheet steps aside and the map shows through (sunChaser.css). The
 * mark goes the moment the pointer lets go, is cancelled, or loses the slider.
 */
const SCRUBBING_ATTRIBUTE = "data-sun-scrubbing";

function setScrubbing(on: boolean): void {
  if (on) document.documentElement.setAttribute(SCRUBBING_ATTRIBUTE, "");
  else document.documentElement.removeAttribute(SCRUBBING_ATTRIBUTE);
}

export default function SunChaserPanel() {
  const state = useSunChaser();
  // A panel closed mid-drag must not leave the sheet hidden.
  useEffect(() => () => setScrubbing(false), []);
  const at = sunChaserSelectedTime(state);
  const timeLabel = state.offsetSteps === 0 || !at ? "Now" : formatSunClock(at, "exact");
  return (
    <>
      <label className="sunChaserScrubber">
        <span>
          Time <strong>{timeLabel}</strong>
        </span>
        <input
          type="range"
          min={0}
          max={MAX_STEPS}
          step={1}
          value={state.offsetSteps}
          aria-valuetext={timeLabel}
          onChange={(event) => updateSunChaser({ offsetSteps: Number(event.target.value) })}
          onPointerDown={() => setScrubbing(true)}
          onPointerUp={() => setScrubbing(false)}
          onPointerCancel={() => setScrubbing(false)}
          onLostPointerCapture={() => setScrubbing(false)}
          onBlur={() => setScrubbing(false)}
        />
      </label>
      <p aria-live="polite" className="sunChaserStatus">{statusLine(state)}</p>
      <p>Gardens likely in the sun get a sun dot beside their pin, once the map shows the pin. {SUN_ESTIMATE_CAVEAT} Trees, awnings and walls are not counted.</p>
    </>
  );
}
