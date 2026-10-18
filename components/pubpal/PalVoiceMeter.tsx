"use client";

import { useEffect, useRef } from "react";

// The live level under the voice panel's status line. It is the panel's proof
// that the microphone is open and that the Pal is the one talking: the bars
// follow the person's input level while the Pal listens and the Pal's own
// output spectrum while it speaks. Nothing here is decoration, so with no live
// session the bars rest flat, and under reduced motion they never animate.

export type PalVoiceMeterMode = "idle" | "connecting" | "listening" | "speaking";

const BAR_COUNT = 24;
// Above this input level the person is taken to be talking. The hysteresis
// keeps the "Hearing you" row from flickering on a breath.
const SPEECH_ON = 0.09;
const SPEECH_OFF = 0.04;
const SPEECH_HOLD_MS = 450;

// A fixed contour, so the person's voice reads as a wave and not a block.
const CONTOUR = Array.from({ length: BAR_COUNT }, (_, index) => {
  const centre = (BAR_COUNT - 1) / 2;
  const distance = Math.abs(index - centre) / centre;
  return 0.35 + 0.65 * Math.cos(distance * Math.PI * 0.5);
});

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export default function PalVoiceMeter({
  mode,
  getInputVolume,
  getOutputByteFrequencyData,
  onVoiceActivity,
}: {
  mode: PalVoiceMeterMode;
  getInputVolume: () => number;
  getOutputByteFrequencyData: () => Uint8Array;
  onVoiceActivity?: (active: boolean) => void;
}) {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);
  const activityRef = useRef(onVoiceActivity);
  useEffect(() => {
    activityRef.current = onVoiceActivity;
  }, [onVoiceActivity]);

  useEffect(() => {
    const bars = barsRef.current;
    const rest = () => {
      for (const bar of bars) bar?.style.setProperty("--level", "0");
    };
    let speaking = false;
    let quietSince = 0;
    const report = (next: boolean) => {
      if (next === speaking) return;
      speaking = next;
      activityRef.current?.(next);
    };
    if (mode !== "listening" && mode !== "speaking") {
      rest();
      report(false);
      return;
    }
    const reduced = prefersReducedMotion();
    let frame = 0;
    let smoothed = new Array<number>(BAR_COUNT).fill(0);
    const tick = (now: number) => {
      let targets: number[];
      if (mode === "speaking") {
        report(false);
        const spectrum = getOutputByteFrequencyData();
        // Speech sits in the low third of the spectrum. The lowest bins feed
        // the middle bars and the meter mirrors outwards, so a voice reads as
        // one shape rather than a pile at the left edge.
        const usable = Math.max(1, Math.floor(spectrum.length / 3));
        const centre = (BAR_COUNT - 1) / 2;
        targets = CONTOUR.map((shape, index) => {
          const distance = Math.abs(index - centre) / centre;
          const bin = Math.min(usable - 1, Math.floor(usable * distance ** 1.6));
          return Math.min(1, ((spectrum[bin] ?? 0) / 255) * (0.6 + 0.6 * shape));
        });
      } else {
        const volume = Math.min(1, Math.max(0, getInputVolume()));
        if (volume > SPEECH_ON) {
          quietSince = 0;
          report(true);
        } else if (volume < SPEECH_OFF) {
          if (!quietSince) quietSince = now;
          if (now - quietSince > SPEECH_HOLD_MS) report(false);
        }
        const lift = Math.min(1, volume * 2.4);
        targets = CONTOUR.map((shape, index) =>
          lift * shape * (0.75 + 0.25 * Math.sin(now / 140 + index * 0.9)),
        );
      }
      smoothed = smoothed.map((value, index) => {
        const target = targets[index] ?? 0;
        // Rise fast and fall slowly, the way a level meter reads.
        return target > value ? value + (target - value) * 0.55 : value + (target - value) * 0.18;
      });
      if (!reduced) {
        smoothed.forEach((value, index) => {
          bars[index]?.style.setProperty("--level", value.toFixed(3));
        });
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      rest();
      report(false);
    };
  }, [getInputVolume, getOutputByteFrequencyData, mode]);

  return (
    <div className="palVoiceMeter" data-mode={mode} aria-hidden="true">
      {CONTOUR.map((_, index) => (
        <span
          key={index}
          ref={(element) => {
            barsRef.current[index] = element;
          }}
          style={{ "--bar": index } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
