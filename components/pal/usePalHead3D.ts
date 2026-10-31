"use client";

import { useEffect, useRef, type RefObject } from "react";

import type { PalAnimationState } from "@/lib/pubPal";
import type { PalTemperament } from "@/lib/palGenome";
import type { PalVoiceSignal, PalVoiceSignalMode } from "@/lib/palVoiceSignal";
import type { PalMeshStatus, PalMeshSurface } from "./originalPalMeshRenderer.mjs";

// One loop reads voice, pointer and tilt for the original photograph or model.
// The optional model loads only for the selected visible portrait.
// Reduced motion retains the still original artwork. Hidden surfaces stop work.

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

export function usePalHead3D(
  frameRef: RefObject<HTMLElement | null>,
  { signal, state, temperament, modelUrl, decorative = false, enabled = true }: {
    signal?: PalVoiceSignal;
    state: PalAnimationState;
    temperament?: PalTemperament;
    /** Only the selected owned portrait or phone voice face supplies a model. */
    modelUrl?: string | null;
    /** A voice face remains outside the accessibility tree and Tab order. */
    decorative?: boolean;
    enabled?: boolean;
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
    if (!frame || !enabled) return;
    const host = modelUrl ? frame.querySelector<HTMLElement>("[data-pal-model-host]") : null;
    const drawing = host?.querySelector<HTMLElement>("[data-pal-model-drawing]");
    let motion: MediaQueryList | null = null;
    try { motion = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch { /* The still artwork remains available. */ }
    const reduced = () => motion?.matches ?? false;
    const inViewport = () => {
      const box = frame.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
    };
    const pose: HeadPose = { ...REST };
    let mouth = 0;
    let pointerX = 0;
    let pointerY = 0;
    let pointerAt = 0;
    let tiltBase: { beta: number; gamma: number } | null = null;
    let visible = modelUrl ? inViewport() : true;
    let raf = 0;
    let disposed = false;
    let parked = false;
    let mesh: PalMeshSurface | null = null;
    let meshReady = false;
    let failed = false;
    let version = 0;
    let requested: number | null = null;
    const active = () => !disposed && !parked && visible && !document.hidden && !reduced();
    const clearCssPose = () => {
      for (const name of ["yaw", "pitch", "roll", "lean", "lift", "scale", "sheen-dx", "sheen-dy", "mouth"]) {
        const property = `--pal-${name}`;
        if (frame.style.getPropertyValue(property)) frame.style.removeProperty(property);
      }
    };
    const setDrawingMode = () => {
      if (!active()) {
        frame.removeAttribute("data-head-3d");
        clearCssPose();
        return;
      }
      const value = meshReady ? "mesh" : "live";
      if (frame.getAttribute("data-head-3d") !== value) frame.setAttribute("data-head-3d", value);
      if (meshReady) clearCssPose();
    };
    const setModelState = (status: PalMeshStatus | "poster") => {
      meshReady = status === "ready";
      if (host) {
        if (host.dataset.modelState !== status) host.dataset.modelState = status;
        const hidden = meshReady && !decorative ? "false" : "true";
        if (host.getAttribute("aria-hidden") !== hidden) host.setAttribute("aria-hidden", hidden);
        if (meshReady && !decorative) host.tabIndex = 0;
        else host.removeAttribute("tabindex");
      }
      setDrawingMode();
    };
    const stop = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      mesh?.setVisible(false);
    };
    const retireModel = () => {
      version += 1;
      requested = null;
      mesh?.dispose();
      mesh = null;
      setModelState("poster");
    };
    const ensureModel = () => {
      if (!modelUrl || !host || !drawing || mesh || failed || requested !== null || !active()) return;
      const ownVersion = ++version;
      requested = ownVersion;
      void import("./originalPalMeshRenderer.mjs")
        .then(({ mountOriginalPalMesh }) => {
          if (disposed || ownVersion !== version || !active()) return;
          const mounted = mountOriginalPalMesh(drawing, {
            modelUrl,
            onStatus(status) {
              if (disposed || ownVersion !== version) return;
              const unavailable = status === "graphics-unavailable" || status === "model-unavailable";
              failed ||= unavailable;
              setModelState(status);
              if (unavailable && mesh) {
                const old = mesh;
                mesh = null;
                old.dispose();
              }
            },
          });
          if (disposed || ownVersion !== version || failed) mounted.dispose();
          else {
            mesh = mounted;
            mesh.setVisible(active());
          }
        })
        .catch(() => {
          if (disposed || ownVersion !== version) return;
          failed = true;
          setModelState("graphics-unavailable");
        })
        .finally(() => {
          if (disposed || ownVersion !== version) return;
          requested = null;
        });
    };

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
      raf = 0;
      if (!active()) {
        updateActivity();
        return;
      }
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
      const writeProperty = (name: string, value: string) => {
        if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
      };
      if (meshReady && mesh) mesh.renderPose(pose, now);
      // Keep the image pose current too, so a graphics failure restores it
      // at the same voice state. Only the live-image CSS applies this pose.
      writeProperty("--pal-yaw", `${pose.yaw.toFixed(2)}deg`);
      writeProperty("--pal-pitch", `${pose.pitch.toFixed(2)}deg`);
      writeProperty("--pal-roll", `${pose.roll.toFixed(2)}deg`);
      writeProperty("--pal-lean", `${pose.lean.toFixed(1)}px`);
      writeProperty("--pal-lift", `${pose.lift.toFixed(1)}px`);
      writeProperty("--pal-scale", pose.scale.toFixed(3));
      // The light stays put while the head turns, so its sheen slides across
      // from where the genome says the light catches this Pal.
      writeProperty("--pal-sheen-dx", `${(-pose.yaw * 2).toFixed(1)}%`);
      writeProperty("--pal-sheen-dy", `${(pose.pitch * 2).toFixed(1)}%`);
      // The mouth opens on the Pal's own voice: quick to open so it lands on
      // the syllable, a little slower to close so it never flickers.
      const open = palMouthOpenness(spoken);
      mouth += (open - mouth) * (open > mouth ? 0.6 : 0.35);
      writeProperty("--pal-mouth", mouth.toFixed(3));
      raf = window.requestAnimationFrame(tick);
    };

    function updateActivity() {
      if (reduced()) {
        stop();
        if (mesh || requested !== null) retireModel();
        setDrawingMode();
        return;
      }
      if (!active()) {
        stop();
        setDrawingMode();
        return;
      }
      // Forward visibility even before ready. A model can finish loading hidden.
      mesh?.setVisible(true);
      ensureModel();
      setDrawingMode();
      if (!raf) raf = window.requestAnimationFrame(tick);
    }
    const onVisibility = () => updateActivity();
    const onMotion = () => updateActivity();
    const onPageHide = () => {
      parked = true;
      stop();
      retireModel();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      parked = false;
      visible = modelUrl ? inViewport() : true;
      failed = false;
      updateActivity();
    };
    const onTurnKey = (event: KeyboardEvent) => {
      if (!meshReady || !mesh) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        mesh.turnYaw(event.key === "ArrowLeft" ? -15 : 15);
      } else if (event.key === "Home") {
        event.preventDefault();
        mesh.setYaw(0);
      }
    };
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(([entry]) => {
        visible = entry?.isIntersecting ?? true;
        updateActivity();
      });
      observer.observe(frame);
    }
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("deviceorientation", onTilt);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    motion?.addEventListener("change", onMotion);
    if (!decorative) host?.addEventListener("keydown", onTurnKey);
    updateActivity();

    return () => {
      disposed = true;
      stop();
      retireModel();
      observer?.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("deviceorientation", onTilt);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
      motion?.removeEventListener("change", onMotion);
      if (!decorative) host?.removeEventListener("keydown", onTurnKey);
      frame.removeAttribute("data-head-3d");
      clearCssPose();
    };
  }, [decorative, enabled, frameRef, modelUrl, signal]);
}
