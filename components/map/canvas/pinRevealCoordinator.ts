export type PinRevealReason = "tiles" | "idle" | "timeout";

type PinRevealCoordinatorOptions = {
  /**
   * Un-gates the local GeoJSON pins if the basemap never reports painted tiles,
   * so the pins can never stay hidden forever. This does NOT lift the parent
   * loading chrome — the pins un-gate behind the skeleton and become visible
   * only when the chrome lifts at a real reveal (or the ready ceiling).
   */
  pinRevealTimeoutMs: number;
  /**
   * Honest upper bound for firing the reveal (which lifts the parent loading
   * chrome) when tiles never settle. The theme-matched skeleton stays up until
   * a real painted frame OR this ceiling, so a slow tile stream can never
   * expose a flat basemap void behind a prematurely retired skeleton.
   */
  readyCeilingMs: number;
  areTilesLoaded: () => boolean;
  setPinsVisible: (visible: boolean) => void;
  subscribeRender: (listener: () => void) => () => void;
  subscribeIdle: (listener: () => void) => () => void;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  setTimer: (callback: () => void, delayMs: number) => number;
  clearTimer: (handle: number) => void;
  onReveal?: (reason: PinRevealReason, generation: number) => void;
};

/**
 * Keeps local GeoJSON pins behind the basemap's first painted tile frame, and
 * keeps the parent loading skeleton up until that same frame. Every style
 * rebuild owns one generation; callbacks from superseded styles are harmless
 * even when the browser delivers a cancelled frame/event late.
 *
 * Two independent clocks guard the two failure modes:
 *  - `pinRevealTimeoutMs`: a short fallback that un-gates the local pins so they
 *    never hang hidden. It does not lift the parent chrome.
 *  - `readyCeilingMs`: a longer honest upper bound that lifts the parent chrome
 *    even if the basemap never reports loaded tiles. The reveal itself always
 *    prefers a real render/idle frame with tiles loaded; the ceiling only fires
 *    when that frame never arrives, so the skeleton (not flat grey) is what the
 *    user sees during a slow tile stream.
 */
export function createPinRevealCoordinator({
  pinRevealTimeoutMs,
  readyCeilingMs,
  areTilesLoaded,
  setPinsVisible,
  subscribeRender,
  subscribeIdle,
  requestFrame,
  cancelFrame,
  setTimer,
  clearTimer,
  onReveal,
}: PinRevealCoordinatorOptions) {
  let generation = 0;
  let state: "idle" | "gated" | "revealed" | "cancelled" = "idle";
  let frame: number | null = null;
  let pinTimer: number | null = null;
  let ceilingTimer: number | null = null;
  let unsubscribeRender: (() => void) | null = null;
  let unsubscribeIdle: (() => void) | null = null;

  const clearPending = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    if (pinTimer !== null) clearTimer(pinTimer);
    pinTimer = null;
    if (ceilingTimer !== null) clearTimer(ceilingTimer);
    ceilingTimer = null;
    unsubscribeRender?.();
    unsubscribeRender = null;
    unsubscribeIdle?.();
    unsubscribeIdle = null;
  };

  const cancelCurrent = () => {
    if (state === "gated") state = "cancelled";
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
    const reveal = (reason: PinRevealReason) => {
      if (!isCurrent()) return;
      state = "revealed";
      clearPending();
      showPins();
      onReveal?.(reason, armedGeneration);
    };
    const scheduleTileReveal = (reason: Exclude<PinRevealReason, "timeout">) => {
      if (!isCurrent() || frame !== null || !areTilesLoaded()) return;
      frame = requestFrame(() => {
        frame = null;
        if (!isCurrent() || !areTilesLoaded()) return;
        reveal(reason);
      });
    };

    unsubscribeRender = subscribeRender(() => scheduleTileReveal("tiles"));
    unsubscribeIdle = subscribeIdle(() => scheduleTileReveal("idle"));
    // Short fallback: un-gate the local pins so they can't hang hidden. This
    // runs behind the still-present parent skeleton and never lifts the chrome.
    pinTimer = setTimer(() => {
      if (isCurrent()) showPins();
    }, pinRevealTimeoutMs);
    // Honest upper bound: lift the parent chrome even if tiles never settle.
    ceilingTimer = setTimer(() => reveal("timeout"), readyCeilingMs);
    return armedGeneration;
  };

  const dispose = () => {
    cancel();
  };

  return { arm, cancel, dispose };
}
