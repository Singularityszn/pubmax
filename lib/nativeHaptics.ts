// Native haptic seam. The Taptic Engine and the Android vibrator are the one
// piece of "this is an app" feedback a WebView cannot fake: iOS Safari and
// WKWebView do not implement navigator.vibrate at all, so the web Vibration
// API answers nothing on the platform that matters most. @capacitor/haptics is
// the only route to it, which is why the dependency is here and nowhere else.
//
// The whole policy is the closed table below. A caller names an OCCASION, not
// an intensity, so the vocabulary cannot drift: two surfaces that mean "the
// price landed" cannot end up on different engines, and widening the set is a
// deliberate edit to one table rather than a number typed at a call site.
//
// Three rules ride with it.
//
// 1. FEEDBACK, NEVER DECORATION. A tap fires on a KEPT action - a price
//    receipt, a save, a check-in - never on navigation, never on a scroll,
//    never on an ordinary button. Over-feedback trains a person to ignore all
//    of it, and a phone that buzzes when you change tabs reads as broken
//    rather than as attentive.
// 2. IT NEVER GATES THE ACTION. Every entry point resolves rather than
//    rejects, and nothing awaits it before showing a result. A missing plugin,
//    a denied vibrator, a silenced phone: the write still lands and the
//    receipt still prints.
// 3. REDUCED MOTION TAKES IT AWAY. Someone who has asked their phone to calm
//    down has asked this too - iOS routes vestibular sensitivity through the
//    same setting - so prefers-reduced-motion silences every occasion.
//
// Web and SSR are no-ops through the canonical isNativeApp() gate, so callers
// invoke these unconditionally and no Capacitor-shaped module lands in the web
// bundle (the import is dynamic, behind the gate, exactly as lib/nativePush.ts
// and lib/nativeSystemBars.ts do it).

import { isNativeApp } from "@/lib/nativePlatform";

/**
 * What just happened, in the app's own words. The closed set is the whole
 * vocabulary: a surface picks the occasion that describes its action, never a
 * raw intensity.
 */
export type HapticOccasion =
  /** A figure, a photo or a report the person contributed landed. */
  | "contribution-kept"
  /** A toggle the person owns flipped on: saved, checked in, joined. */
  | "selection-kept"
  /** A destructive or undoing tap landed: removed, left, cleared. */
  | "selection-released"
  /** The action could not be kept and the person has to do something. */
  | "action-refused"
  /** A route was locked in: the plan now exists and has a link to share. */
  | "plan-locked";

export type HapticEngine =
  | { kind: "impact"; style: "Light" | "Medium" | "Heavy" }
  | { kind: "notification"; style: "Success" | "Warning" | "Error" };

/**
 * The one table. `contribution-kept` is the heaviest thing here on purpose:
 * a Pint Drop is the action the whole product is built around, and it earns
 * the notification engine's two-beat pattern. `plan-locked` is the one other
 * success that does: locking a route is the moment a plan becomes real. A sheet
 * snapping to a detent is NOT an occasion (rule 1: never navigation or scroll).
 */
const OCCASION_ENGINE: Record<HapticOccasion, HapticEngine> = {
  "contribution-kept": { kind: "notification", style: "Success" },
  "selection-kept": { kind: "impact", style: "Medium" },
  "selection-released": { kind: "impact", style: "Light" },
  "action-refused": { kind: "notification", style: "Warning" },
  "plan-locked": { kind: "notification", style: "Success" },
};

/** Every occasion, in table order. The fence reads this rather than a copy. */
export const HAPTIC_OCCASIONS = Object.keys(OCCASION_ENGINE) as HapticOccasion[];

/** The engine an occasion plays on. Pure; exported for the contract test. */
export function hapticEngineFor(occasion: HapticOccasion): HapticEngine {
  return OCCASION_ENGINE[occasion];
}

/**
 * Whether this device has asked for less motion. iOS reports Reduce Motion
 * through this query inside the WebView, and a person who set it has asked the
 * phone to stop moving under them; a buzz is the same request.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

export type HapticGateState = {
  /** Native shell only - always false (never buzz) on web/SSR. */
  isNative: boolean;
  /** The device has asked for reduced motion. */
  reducedMotion: boolean;
};

/**
 * Pure gate - exported for unit testing. No plugin, storage or DOM access.
 * Both conditions are hard: web never buzzes, and reduced motion never buzzes.
 */
export function shouldPlayHaptic(state: HapticGateState): boolean {
  if (!state.isNative) return false;
  if (state.reducedMotion) return false;
  return true;
}

/**
 * Play the tap for one occasion. Resolves true only when the plugin actually
 * played it, false when skipped or unavailable - and NEVER rejects, so a
 * caller may fire it beside a receipt without a catch and without an await.
 */
export async function playHaptic(occasion: HapticOccasion): Promise<boolean> {
  if (!shouldPlayHaptic({ isNative: isNativeApp(), reducedMotion: prefersReducedMotion() })) {
    return false;
  }
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
    const engine = hapticEngineFor(occasion);
    if (engine.kind === "impact") {
      await Haptics.impact({ style: ImpactStyle[engine.style] });
    } else {
      await Haptics.notification({ type: NotificationType[engine.style] });
    }
    return true;
  } catch {
    // No plugin, no vibrator, permission refused, or a silenced phone. The
    // action this accompanies has already landed; a missing buzz costs it
    // nothing.
    return false;
  }
}

/**
 * Fire-and-forget form for a success path that must not wait on a buzz. This
 * is the one every caller should reach for; playHaptic() stays exported for
 * the rare surface that wants to know whether it played.
 */
export function haptic(occasion: HapticOccasion): void {
  void playHaptic(occasion);
}
