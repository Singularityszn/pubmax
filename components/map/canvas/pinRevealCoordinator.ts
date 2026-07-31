export type PinRevealReason = "tiles" | "idle" | "timeout";
export type BasemapNoticeOwner = "none" | "timeout" | "errors";

export const BASEMAP_RETRY_NOTICE = {
  kind: "tiles",
  message: "Map background couldn't load. Tap Retry to try again.",
} as const;

export function basemapRetryForReveal(
  reason: PinRevealReason,
  currentOwner: BasemapNoticeOwner,
): {
  kind: "tiles";
  message: string;
} | null {
  if (reason !== "timeout" || currentOwner === "errors") return null;
  return BASEMAP_RETRY_NOTICE;
}

type PinRevealCoordinatorOptions = {
  /**
   * Un-gates the local GeoJSON pins if the basemap never reports painted tiles,
   * so the pins can never stay hidden forever. This does NOT lift the parent
   * loading chrome — the pins un-gate behind the skeleton and become visible
   * only when the chrome lifts at a real reveal (or the ready ceiling).
   */
  pinRevealTimeoutMs: number;
  /**
   * Honest upper bound for firing the reveal when a required paint signal
   * never arrives. The loading skeleton stays up until a real qualifying frame
   * or this ceiling.
   */
  readyCeilingMs: number;
  hasBasemapPainted: () => boolean;
  hasPinsPaintable: () => boolean;
  /**
   * Keep parent loading chrome up for one render after pin layers become
   * visible. The render that discovers source readiness was painted while
   * those layers were still hidden.
   */
  confirmVisibleFrameBeforeReveal?: boolean;
  /** Optional compositor guard after the confirmed visible render. */
  visibleFrameHoldMs?: number;
  setPinsVisible: (visible: boolean) => void;
  subscribeRender: (listener: () => void) => () => void;
  subscribeIdle: (listener: () => void) => () => void;
  setTimer: (callback: () => void, delayMs: number) => number;
  clearTimer: (handle: number) => void;
  canRecoverAfterTimeout?: () => boolean;
  onPaintAfterTimeout?: (generation: number) => void;
  onReveal?: (reason: PinRevealReason, generation: number) => void;
};

/**
 * Keeps local GeoJSON pins behind configured basemap and source paint signals,
 * then keeps parent loading chrome up until its configured visible-frame gate.
 * Every style rebuild owns one generation; callbacks from superseded styles
 * are harmless even when the browser delivers an old event late.
 *
 * Two independent clocks guard the two failure modes:
 *  - `pinRevealTimeoutMs`: a short fallback that un-gates the local pins so they
 *    never hang hidden. It does not lift the parent chrome.
 *  - `readyCeilingMs`: a longer honest upper bound that lifts the parent chrome
 *    even if a required signal never arrives. A consumer may turn that timeout
 *    into an explicit degraded or error surface.
 */
export function createPinRevealCoordinator({
  pinRevealTimeoutMs,
  readyCeilingMs,
  hasBasemapPainted,
  hasPinsPaintable,
  confirmVisibleFrameBeforeReveal = false,
  visibleFrameHoldMs = 0,
  setPinsVisible,
  subscribeRender,
  subscribeIdle,
  setTimer,
  clearTimer,
  canRecoverAfterTimeout,
  onPaintAfterTimeout,
  onReveal,
}: PinRevealCoordinatorOptions) {
  let generation = 0;
  let state:
    | "idle"
    | "gated"
    | "awaiting-visible-frame"
    | "revealed"
    | "cancelled" = "idle";
  let pinTimer: number | null = null;
  let ceilingTimer: number | null = null;
  let visibleTimer: number | null = null;
  let unsubscribeRender: (() => void) | null = null;
  let unsubscribeIdle: (() => void) | null = null;

  const clearPending = () => {
    if (pinTimer !== null) clearTimer(pinTimer);
    pinTimer = null;
    if (ceilingTimer !== null) clearTimer(ceilingTimer);
    ceilingTimer = null;
    if (visibleTimer !== null) clearTimer(visibleTimer);
    visibleTimer = null;
    unsubscribeRender?.();
    unsubscribeRender = null;
    unsubscribeIdle?.();
    unsubscribeIdle = null;
  };

  const cancelCurrent = () => {
    if (state === "gated" || state === "awaiting-visible-frame") {
      state = "cancelled";
    }
    clearPending();
  };

  const cancel = () => {
    generation += 1;
    cancelCurrent();
  };

  const arm = (): number => {
    cancelCurrent();
    generation += 1;
    const armedGeneration = generation;
    state = "gated";
    setPinsVisible(false);
    let pinsShown = false;

    const isCurrent = () => generation === armedGeneration && state === "gated";
    const showPins = () => {
      if (pinsShown) return;
      pinsShown = true;
      setPinsVisible(true);
    };
    const finishReveal = (reason: PinRevealReason) => {
      if (
        generation !== armedGeneration ||
        (state !== "gated" && state !== "awaiting-visible-frame")
      ) {
        return;
      }
      state = "revealed";
      clearPending();
      showPins();
      onReveal?.(reason, armedGeneration);
      if (reason !== "timeout" || !onPaintAfterTimeout) return;
      const scheduleTimeoutRecovery = () => {
        if (
          generation !== armedGeneration ||
          state !== "revealed" ||
          !hasBasemapPainted()
        ) return;
        const canRecover = canRecoverAfterTimeout?.() ?? true;
        clearPending();
        if (canRecover) onPaintAfterTimeout(armedGeneration);
      };
      unsubscribeRender = subscribeRender(scheduleTimeoutRecovery);
      unsubscribeIdle = subscribeIdle(scheduleTimeoutRecovery);
    };
    const reveal = (reason: PinRevealReason) => {
      if (!isCurrent()) return;
      showPins();
      if (!confirmVisibleFrameBeforeReveal) {
        finishReveal(reason);
        return;
      }
      state = "awaiting-visible-frame";
      clearPending();
      unsubscribeRender = subscribeRender(() => {
        unsubscribeRender?.();
        unsubscribeRender = null;
        if (visibleFrameHoldMs <= 0) {
          finishReveal(reason);
          return;
        }
        visibleTimer = setTimer(
          () => finishReveal(reason),
          visibleFrameHoldMs,
        );
      });
    };
    const revealPainted = (reason: Exclude<PinRevealReason, "timeout">) => {
      if (!isCurrent() || !hasBasemapPainted() || !hasPinsPaintable()) return;
      reveal(reason);
    };

    unsubscribeRender = subscribeRender(() => revealPainted("tiles"));
    unsubscribeIdle = subscribeIdle(() => revealPainted("idle"));
    // Short fallback: un-gate the local pins so they can't hang hidden. This
    // runs behind the still-present parent skeleton and never lifts the chrome.
    pinTimer = setTimer(() => {
      if (isCurrent()) showPins();
    }, pinRevealTimeoutMs);
    // Honest upper bound: lift the parent chrome if no tile becomes paintable.
    ceilingTimer = setTimer(() => reveal("timeout"), readyCeilingMs);
    return armedGeneration;
  };

  const dispose = () => {
    cancel();
  };

  return { arm, cancel, dispose };
}
