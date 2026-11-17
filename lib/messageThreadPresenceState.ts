type Binding = Readonly<{ token: string; bearer: string }>;
type Lease = Binding & { readonly activityId: number };
type Context = { readonly revision: number; readonly lease?: Lease };
export type ThreadPresenceState = Context & (
  | { readonly phase: "idle" }
  | { readonly phase: "loading" }
  | { readonly phase: "visible"; readonly lease: Lease }
  | { readonly phase: "hidden" }
  | { readonly phase: "stopped" }
  | { readonly phase: "reserving"; readonly binding: Binding }
);
export type ThreadPresenceEvent =
  | { type: "refresh" }
  | { type: "hide" | "stop" | "ownership-lost" }
  | { type: "credentials"; revision: number; binding: Binding | null }
  | { type: "reserved"; revision: number; activityId: number | null }
  | { type: "failed"; revision: number }
  | { type: "delivered" | "notifications-loaded"; revision: number };
export type ThreadPresenceEffect =
  | { type: "credentials"; revision: number }
  | { type: "reserve"; revision: number; binding: Binding }
  | { type: "send"; revision: number; lease: Lease; visible: boolean }
  | { type: "notifications"; revision: number }
  | { type: "close-notifications" }
  | { type: "abort" };
type Transition = { state: ThreadPresenceState; effects: readonly ThreadPresenceEffect[] };
export const INITIAL_THREAD_PRESENCE: ThreadPresenceState = { phase: "idle", revision: 0 };

function validActivityId(value: number | null): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function transitionThreadPresence(state: ThreadPresenceState, event: ThreadPresenceEvent): Transition {
  const unchanged: Transition = { state, effects: [] };
  if (state.phase === "stopped") return unchanged;
  if ("revision" in event && event.revision !== state.revision) return unchanged;
  switch (event.type) {
    case "refresh": {
      if (state.phase === "loading" || state.phase === "reserving") return unchanged;
      const revision = state.revision + 1;
      return { state: { phase: "loading", revision, lease: state.lease }, effects: [{ type: "credentials", revision }] };
    }
    case "hide":
    case "stop":
    case "ownership-lost": {
      if (event.type === "hide" && state.phase === "hidden") return unchanged;
      const revision = state.revision + 1;
      return {
        state: { phase: event.type === "hide" ? "hidden" : "stopped", revision, lease: state.lease },
        effects: [
          ...(state.lease && event.type !== "ownership-lost" ? [{ type: "send" as const, revision, lease: state.lease, visible: false }] : []),
          ...(event.type !== "hide" ? [{ type: "abort" as const }] : []),
        ],
      };
    }
    case "credentials": {
      if (state.phase !== "loading") return unchanged;
      if (!event.binding) return { state: { phase: "idle", revision: state.revision, lease: state.lease }, effects: [] };
      const sameBinding = state.lease?.token === event.binding.token && state.lease.bearer === event.binding.bearer;
      return {
        state: { phase: "reserving", revision: state.revision, binding: event.binding, lease: sameBinding ? state.lease : undefined },
        effects: [
          ...(state.lease && !sameBinding ? [{ type: "send" as const, revision: state.revision, lease: state.lease, visible: false }] : []),
          { type: "reserve", revision: state.revision, binding: event.binding },
        ],
      };
    }
    case "reserved": {
      if (state.phase !== "reserving") return unchanged;
      if (!validActivityId(event.activityId)) return { state: { phase: "idle", revision: state.revision, lease: state.lease }, effects: [] };
      const lease = { ...state.binding, activityId: event.activityId };
      return { state: { phase: "visible", revision: state.revision, lease }, effects: [{ type: "send", revision: state.revision, lease, visible: true }] };
    }
    case "failed":
      return state.phase === "loading" || state.phase === "reserving"
        ? { state: { phase: "idle", revision: state.revision, lease: state.lease }, effects: [] }
        : unchanged;
    case "delivered":
      return state.phase === "visible" ? { state, effects: [{ type: "notifications", revision: state.revision }] } : unchanged;
    case "notifications-loaded":
      return state.phase === "visible" ? { state, effects: [{ type: "close-notifications" }] } : unchanged;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
