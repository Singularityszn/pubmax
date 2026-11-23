// The dock's idle tab warm, as one machine. It decides WHEN the dock may warm
// the tabs a reader has not asked for. The hook that owns the load listener,
// the timer and the idle callback is components/nav/useIdleTabWarm.ts.
// Measurements and policy: docs/rules/perf-budgets-and-measured-findings.md.

/** How long a loaded page keeps the wire to itself before the dock warms the other tabs. */
export const IDLE_TAB_WARM_DELAY_MS = 4_000;

export type IdleTabWarmState =
  /** Not started, stopped, or refused because the reader asked for less data. */
  | { phase: "off" }
  | { phase: "awaiting_load" }
  | { phase: "awaiting_delay" }
  | { phase: "awaiting_idle" }
  | { phase: "warmed" };

export type IdleTabWarmEvent =
  /** `allowed` is the connection policy. `loaded` is true when the document has already loaded. */
  | { type: "start"; allowed: boolean; loaded: boolean }
  | { type: "loaded" }
  | { type: "delay_elapsed" }
  /** The connection and the tab can both change during the wait, so both are read again. */
  | { type: "idle"; allowed: boolean; visible: boolean }
  | { type: "cancel" };

const OFF: IdleTabWarmState = { phase: "off" };

/** An event that does not belong to the current stage returns the SAME state. */
export function transitionIdleTabWarm(state: IdleTabWarmState, event: IdleTabWarmEvent): IdleTabWarmState {
  if (event.type === "cancel") return state.phase === "off" || state.phase === "warmed" ? state : OFF;
  switch (state.phase) {
    case "off":
      if (event.type !== "start" || !event.allowed) return state;
      return { phase: event.loaded ? "awaiting_delay" : "awaiting_load" };
    case "awaiting_load":
      return event.type === "loaded" ? { phase: "awaiting_delay" } : state;
    case "awaiting_delay":
      return event.type === "delay_elapsed" ? { phase: "awaiting_idle" } : state;
    case "awaiting_idle":
      if (event.type !== "idle") return state;
      return event.allowed && event.visible ? { phase: "warmed" } : OFF;
    case "warmed":
      return state;
  }
}
