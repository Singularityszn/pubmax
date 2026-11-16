type SlimLoadReaders = {
  readonly holds: readonly number[];
  readonly shared: boolean;
};

export type SlimLoadLifecycleState =
  | ({ readonly phase: "fetching" } & SlimLoadReaders)
  | ({ readonly phase: "landed" } & SlimLoadReaders)
  | ({ readonly phase: "retrying" } & SlimLoadReaders)
  | { readonly phase: "aborted" }
  | { readonly phase: "settled" };

export type SlimLoadLifecycleEvent =
  | { type: "hold"; id: number }
  | { type: "release"; id: number }
  | { type: "rejoin" }
  | { type: "landed" }
  | { type: "reopen" }
  | { type: "check-unread" }
  | { type: "failed" }
  | { type: "settled" };

type SlimLoadLifecycleEffect = "check-unread" | "drop-entry" | "abort";

export const INITIAL_SLIM_LOAD_LIFECYCLE: SlimLoadLifecycleState = {
  phase: "fetching",
  holds: [],
  shared: false,
};

export function transitionSlimLoadLifecycle(
  state: SlimLoadLifecycleState,
  event: SlimLoadLifecycleEvent,
): { state: SlimLoadLifecycleState; effects: readonly SlimLoadLifecycleEffect[] } {
  if (state.phase === "aborted" || state.phase === "settled") return { state, effects: [] };

  switch (event.type) {
    case "hold":
      return state.holds.includes(event.id)
        ? { state, effects: [] }
        : { state: { ...state, holds: [...state.holds, event.id] }, effects: [] };
    case "release":
      return state.holds.includes(event.id)
        ? {
          state: { ...state, holds: state.holds.filter((id) => id !== event.id) },
          effects: ["check-unread"],
        }
        : { state, effects: [] };
    case "rejoin":
      return state.shared
        ? { state, effects: [] }
        : { state: { ...state, shared: true }, effects: [] };
    case "landed":
      return state.phase === "landed"
        ? { state, effects: [] }
        : { state: { ...state, phase: "landed" }, effects: [] };
    case "reopen":
      if (state.phase !== "landed") return { state, effects: [] };
      return state.holds.length === 0 && !state.shared
        ? { state: { phase: "aborted" }, effects: ["drop-entry", "abort"] }
        : { state: { ...state, phase: "retrying" }, effects: [] };
    case "check-unread":
      return state.phase !== "landed" && state.holds.length === 0 && !state.shared
        ? { state: { phase: "aborted" }, effects: ["drop-entry", "abort"] }
        : { state, effects: [] };
    case "failed":
    case "settled":
      return { state: { phase: "settled" }, effects: ["drop-entry"] };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
