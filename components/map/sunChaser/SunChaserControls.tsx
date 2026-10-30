"use client";

// The Sun Chaser chip and its time scrubber, inside the map's pub feature
// controls on both widths. Light on purpose: the maths and the map layer load
// only after the chip is on (components/PubMap.tsx mounts SunChaserLayer).

import {
  formatSunClock,
  segmentAt,
  SUN_CHASER_HORIZON_MINUTES,
  SUN_CHASER_STEP_MINUTES,
  SUN_ESTIMATE_CAVEAT,
  sunSkyNote,
} from "@/lib/sunChaser";
import { setSunChaserEnabled, updateSunChaser, useSunChaser, type SunChaserState } from "./sunChaserStore";

const MAX_STEPS = SUN_CHASER_HORIZON_MINUTES / SUN_CHASER_STEP_MINUTES;

export function sunChaserSelectedTime(state: Pick<SunChaserState, "from" | "offsetSteps">): Date | null {
  return state.from ? new Date(state.from.getTime() + state.offsetSteps * SUN_CHASER_STEP_MINUTES * 60_000) : null;
}

function statusLine(state: SunChaserState): string {
  if (state.status === "zoom-in") return "Zoom in to street level to see which gardens are in the sun.";
  if (state.status === "no-buildings") return "No sun estimate: no building heights loaded here.";
  const at = sunChaserSelectedTime(state);
  if (state.status !== "ready" || !at) return "Working out the sun for gardens in view.";
  let gardens = 0;
  let inSun = 0;
  let sunState: "sun" | null = null;
  for (const estimate of state.estimates.values()) {
    if (estimate.kind !== "estimate") continue;
    gardens += 1;
    if (segmentAt(estimate.timeline, at)?.state === "sun") {
      inSun += 1;
      sunState = "sun";
    }
  }
  if (gardens === 0) return "No recorded gardens or outdoor seating in view.";
  const when = state.offsetSteps === 0 ? "now" : `at ${formatSunClock(at)}`;
  const line = `${inSun} of ${gardens} recorded ${gardens === 1 ? "garden" : "gardens"} in view likely in the sun ${when}.`;
  const sky = sunSkyNote(sunState ?? "shade", state.offsetSteps === 0, state.skyCondition);
  return sky ? `${line} ${sky.replace("Sunny spot", "Sunny spots")}` : line;
}

export default function SunChaserControls() {
  const state = useSunChaser();
  const at = sunChaserSelectedTime(state);
  const timeLabel = state.offsetSteps === 0 || !at ? "Now" : formatSunClock(at);
  return (
    <div className="sunChaserControls">
      <button
        type="button"
        className="sunChaserChip"
        aria-pressed={state.enabled}
        onClick={() => setSunChaserEnabled(!state.enabled)}
      >
        <span aria-hidden="true" className="sunChaserChipDot" />
        Sun Chaser
      </button>
      {state.enabled ? (
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
            />
          </label>
          <p aria-live="polite" className="sunChaserStatus">{statusLine(state)}</p>
          <p>Gardens likely in the sun get a sun dot. {SUN_ESTIMATE_CAVEAT} Trees, awnings and walls are not counted.</p>
        </>
      ) : null}
    </div>
  );
}
