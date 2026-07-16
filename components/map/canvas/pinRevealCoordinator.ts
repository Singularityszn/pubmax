export type PinRevealReason = "tiles" | "idle" | "timeout";

type PinRevealCoordinatorOptions = {
  timeoutMs: number;
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
 * Keeps local GeoJSON pins behind the basemap's first painted tile frame.
 * Every style rebuild owns one generation; callbacks from superseded styles
 * are harmless even when the browser delivers a cancelled frame/event late.
 */
export function createPinRevealCoordinator({
  timeoutMs,
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
  let timer: number | null = null;
  let unsubscribeRender: (() => void) | null = null;
  let unsubscribeIdle: (() => void) | null = null;

  const clearPending = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    if (timer !== null) clearTimer(timer);
    timer = null;
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

    const isCurrent = () => generation === armedGeneration && state === "gated";
    const reveal = (reason: PinRevealReason) => {
      if (!isCurrent()) return;
      state = "revealed";
      clearPending();
      setPinsVisible(true);
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
    timer = setTimer(() => reveal("timeout"), timeoutMs);
    scheduleTileReveal("tiles");
    return armedGeneration;
  };

  const dispose = () => {
    cancel();
  };

  return { arm, cancel, dispose };
}
