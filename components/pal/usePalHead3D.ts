"use client";

import { useEffect, useRef, type RefObject } from "react";

import type { PalAnimationState } from "@/lib/pubPal";
import type { PalTemperament } from "@/lib/palGenome";
import type { PalVoiceSignal, PalVoiceSignalMode } from "@/lib/palVoiceSignal";

// The Pal's head in 3D, from the photograph it already is.
//
// "Every Pub Pal is a rendered master, and state motion moves the whole
// photograph" (docs/rules/components-design-system-and-launch-primitives.md),
// so nothing here draws the animal. The loop writes a handful of CSS custom
// properties on the portrait's frame, and app/pal/pal.css turns them into a
// perspective turn, a lean and a nod, with the layers behind and in front of
// the photograph at their own depth so the turn reads as a head, not a card.
//
// What moves it:
// - the pointer, or the phone's tilt where the browser sends it unasked;
// - the person's voice while the Pal listens: it leans in and perks up;
// - the Pal's own voice while it speaks: it bobs and nods on the words;
// - thinking: it tips its head and looks up.
// Under reduced motion the loop never starts and the photograph stays still.
// Off screen, or in a hidden tab, the loop sleeps.

type HeadPose = {
  yaw: number;
  pitch: number;
  roll: number;
  lean: number;
  lift: number;
  scale: number;
};

const REST: HeadPose = { yaw: 0, pitch: 0, roll: 0, lean: 0, lift: 0, scale: 1 };
const EVEN_TEMPERAMENT: PalTemperament = { pace: 1, sway: 1, nod: 1, keen: 1 };
const POINTER_IDLE_MS = 3_000;

function voiceModeFor(state: PalAnimationState): PalVoiceSignalMode {
  if (state === "speaking") return "speaking";
  if (state === "listening") return "listening";
  if (state === "noticing") return "connecting";
  return "idle";
}

/**
 * How open the mouth is for a spoken level (0 to 1). A whisper of output under
 * the floor keeps it shut, and a normal word opens it most of the way. Pure,
 * so it is tested.
 */
export function palMouthOpenness(spoken: number): number {
  if (!Number.isFinite(spoken) || spoken <= 0) return 0;
  return Math.min(1, Math.max(0, (spoken - 0.06) * 2.4));
}

/** The pose the head is heading towards this frame. Pure, so it is tested. */
export function palHeadTarget(input: {
  t: number;
  pointerX: number;
  pointerY: number;
  mode: PalVoiceSignalMode;
  state: PalAnimationState;
  heard: number;
  spoken: number;
  /** The Pal genome's temperament; an even one when there is none. */
  temperament?: PalTemperament;
}): HeadPose {
  const { t, pointerX, pointerY, mode, state, heard, spoken } = input;
  const { pace, sway, nod, keen } = input.temperament ?? EVEN_TEMPERAMENT;
  const pose: HeadPose = {
    // A slow sway, so a still Pal still looks alive. Its speed and size are
    // the Pal's own.
    yaw: Math.sin(t * 0.5 * pace) * 4 * sway + pointerX * 16,
    pitch: Math.sin(t * 0.37 * pace) * 2 * sway - pointerY * 10,
    roll: 0,
    lean: 0,
    lift: 0,
    scale: 1,
  };
  if (state === "thinking") {
    pose.roll = 7;
    pose.pitch -= 6;
    pose.yaw += Math.sin(t * 0.8) * 5;
  } else if (state === "sleeping") {
    pose.pitch += 8;
    pose.roll = -4;
  } else if (state === "waking") {
    // Head up and a stretch, out of the sleeping droop.
    pose.pitch -= 6;
    pose.lift = 10;
    pose.scale = 1.03;
  }
  if (mode === "listening") {
    // Leans in, and perks up on each syllable it hears.
    pose.lean = (14 + heard * 36) * keen;
    pose.pitch += 4 + heard * 4 * keen;
    pose.roll += Math.sin(t * 1.3 * pace) * 2 * sway + heard * 6 * keen;
  } else if (mode === "speaking") {
    pose.lift = spoken * 14;
    pose.scale = 1 + spoken * 0.05;
    pose.pitch += Math.sin(t * 7 * pace) * spoken * 7 * nod;
    pose.yaw += Math.sin(t * 3.1 * pace) * spoken * 4 * nod;
  } else if (mode === "connecting") {
    pose.lean = 8;
    pose.yaw += Math.sin(t * 2.4) * 6;
  }
  return pose;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function usePalHead3D(
  frameRef: RefObject<HTMLElement | null>,
  { signal, state, temperament }: {
    signal?: PalVoiceSignal;
    state: PalAnimationState;
    temperament?: PalTemperament;
  },
): void {
  const stateRef = useRef(state);
  const temperamentRef = useRef(temperament);
  useEffect(() => {
    stateRef.current = state;
    temperamentRef.current = temperament;
  }, [state, temperament]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || prefersReducedMotion()) return;

    const pose: HeadPose = { ...REST };
    let mouth = 0;
    let pointerX = 0;
    let pointerY = 0;
    let pointerAt = 0;
    let tiltBase: { beta: number; gamma: number } | null = null;
    let visible = true;
    let raf = 0;

    const onPointer = (event: PointerEvent) => {
      const box = frame.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const half = Math.max(box.width, window.innerWidth / 3);
      pointerX = Math.max(-1, Math.min(1, (event.clientX - (box.left + box.width / 2)) / half));
      pointerY = Math.max(-1, Math.min(1, (event.clientY - (box.top + box.height / 2)) / half));
      pointerAt = performance.now();
    };
    // The tilt is read only when the browser sends it without asking; the
    // panel never prompts for motion permission for a flourish.
    const onTilt = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) return;
      tiltBase ??= { beta: event.beta, gamma: event.gamma };
      pointerX = Math.max(-1, Math.min(1, (event.gamma - tiltBase.gamma) / 25));
      pointerY = Math.max(-1, Math.min(1, (event.beta - tiltBase.beta) / 25));
      pointerAt = performance.now();
    };

    const tick = (now: number) => {
      const t = now / 1000;
      if (now - pointerAt > POINTER_IDLE_MS) {
        pointerX *= 0.96;
        pointerY *= 0.96;
      }
      const levels = signal?.read();
      const currentState = stateRef.current;
      const mode = levels && levels.mode !== "idle" ? levels.mode : voiceModeFor(currentState);
      // With no live levels (a typed chat), the state alone gives a gentle
      // talking rhythm instead of a frozen head.
      const spoken = levels && levels.mode === "speaking"
        ? levels.output
        : mode === "speaking" ? 0.3 + 0.2 * Math.sin(t * 9) : 0;
      const target = palHeadTarget({
        t,
        pointerX,
        pointerY,
        mode,
        state: currentState,
        heard: levels?.input ?? 0,
        spoken,
        temperament: temperamentRef.current,
      });
      // Angles ease; the speaking bob is quicker so it lands on the words.
      pose.yaw += (target.yaw - pose.yaw) * 0.12;
      pose.pitch += (target.pitch - pose.pitch) * 0.12;
      pose.roll += (target.roll - pose.roll) * 0.1;
      pose.lean += (target.lean - pose.lean) * 0.15;
      pose.lift += (target.lift - pose.lift) * 0.4;
      pose.scale += (target.scale - pose.scale) * 0.4;
      const style = frame.style;
      style.setProperty("--pal-yaw", `${pose.yaw.toFixed(2)}deg`);
      style.setProperty("--pal-pitch", `${pose.pitch.toFixed(2)}deg`);
      style.setProperty("--pal-roll", `${pose.roll.toFixed(2)}deg`);
      style.setProperty("--pal-lean", `${pose.lean.toFixed(1)}px`);
      style.setProperty("--pal-lift", `${pose.lift.toFixed(1)}px`);
      style.setProperty("--pal-scale", pose.scale.toFixed(3));
      // The light stays put while the head turns, so its sheen slides across
      // from where the genome says the light catches this Pal.
      style.setProperty("--pal-sheen-dx", `${(-pose.yaw * 2).toFixed(1)}%`);
      style.setProperty("--pal-sheen-dy", `${(pose.pitch * 2).toFixed(1)}%`);
      // The mouth opens on the Pal's own voice: quick to open so it lands on
      // the syllable, a little slower to close so it never flickers.
      const open = palMouthOpenness(spoken);
      mouth += (open - mouth) * (open > mouth ? 0.6 : 0.35);
      style.setProperty("--pal-mouth", mouth.toFixed(3));
      raf = window.requestAnimationFrame(tick);
    };

    const start = () => {
      if (raf || !visible || document.hidden) return;
      raf = window.requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? true;
        if (visible) start();
        else stop();
      });
      observer.observe(frame);
    }

    frame.setAttribute("data-head-3d", "live");
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("deviceorientation", onTilt);
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      observer?.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("deviceorientation", onTilt);
      document.removeEventListener("visibilitychange", onVisibility);
      frame.removeAttribute("data-head-3d");
      for (const name of ["yaw", "pitch", "roll", "lean", "lift", "scale", "sheen-dx", "sheen-dy", "mouth"]) {
        frame.style.removeProperty(`--pal-${name}`);
      }
    };
  }, [frameRef, signal]);
}
