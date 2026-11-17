type Binding = Readonly<{ token: string; bearer: string; sessionId: string }>;
type Lease = Binding & { readonly activityId: number };
type Context = { readonly revision: number; readonly lease?: Lease };
export type ThreadPresenceState = Context & (
  | { readonly phase: "idle" }
  | { readonly phase: "loading"; readonly reuse: boolean }
  | { readonly phase: "visible"; readonly lease: Lease }
  | { readonly phase: "hidden" }
  | { readonly phase: "paused"; readonly departureRevision: number }
  | { readonly phase: "stopped" }
  | { readonly phase: "reserving"; readonly binding: Binding }
);
export type ThreadPresenceEvent =
  | { type: "refresh" }
  | { type: "hide" | "stop" | "ownership-lost" }
  | { type: "depart"; departureRevision: number }
  | { type: "restored"; departureRevision: number; token: string; sessionId: string }
  | { type: "credentials"; revision: number; binding: Binding | null }
  | { type: "reserved"; revision: number; activityId: number | null }
  | { type: "failed"; revision: number }
  | { type: "delivered"; revision: number; applied: boolean }
  | { type: "notifications-loaded"; revision: number };
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

function sameBinding(left: Binding, right: Pick<Binding, "token" | "sessionId">): boolean {
  return left.token === right.token && left.sessionId === right.sessionId;
}

export function transitionThreadPresence(state: ThreadPresenceState, event: ThreadPresenceEvent): Transition {
  const unchanged: Transition = { state, effects: [] };
  if (state.phase === "stopped") return unchanged;
  if ("revision" in event && event.revision !== state.revision) return unchanged;
  if (state.phase === "paused" && event.type !== "restored" && event.type !== "depart" && event.type !== "stop" && event.type !== "ownership-lost") return unchanged;
  switch (event.type) {
    case "refresh": {
      if (state.phase === "loading" || state.phase === "reserving") return unchanged;
      const revision = state.revision + 1;
      return { state: { phase: "loading", revision, lease: state.lease, reuse: state.phase === "visible" }, effects: [{ type: "credentials", revision }] };
    }
    case "hide":
    case "depart":
    case "stop":
    case "ownership-lost": {
      if (event.type === "hide" && state.phase === "hidden") return unchanged;
      const revision = state.revision + 1;
      const context = { revision, lease: state.lease };
      return {
        state: event.type === "depart" ? { ...context, phase: "paused", departureRevision: event.departureRevision }
          : { ...context, phase: event.type === "hide" ? "hidden" : "stopped" },
        effects: [
          { type: "abort" },
          ...(state.lease && event.type !== "ownership-lost" ? [{ type: "send" as const, revision, lease: state.lease, visible: false }] : []),
        ],
      };
    }
    case "restored":
      if (state.phase !== "paused" || event.departureRevision !== state.departureRevision || (state.lease && !sameBinding(state.lease, event))) return unchanged;
      return { state: { phase: "hidden", revision: state.revision + 1 }, effects: [] };
    case "credentials": {
      if (state.phase !== "loading") return unchanged;
      if (!event.binding) return { state: { phase: "idle", revision: state.revision, lease: state.lease }, effects: [] };
      const same = state.lease && sameBinding(state.lease, event.binding);
      if (same && state.reuse && state.lease) {
        const lease = { ...state.lease, ...event.binding };
        return { state: { phase: "visible", revision: state.revision, lease }, effects: [{ type: "send", revision: state.revision, lease, visible: true }] };
      }
      return {
        state: { phase: "reserving", revision: state.revision, binding: event.binding, lease: same ? state.lease : undefined },
        effects: [
          ...(state.lease && !same ? [{ type: "send" as const, revision: state.revision, lease: state.lease, visible: false }] : []),
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
      return state.phase === "loading" || state.phase === "reserving" || state.phase === "visible"
        ? { state: { phase: "idle", revision: state.revision + 1, lease: state.lease }, effects: [{ type: "abort" }] }
        : unchanged;
    case "delivered":
      if (state.phase !== "visible") return unchanged;
      return event.applied ? { state, effects: [{ type: "notifications", revision: state.revision }] }
        : { state: { phase: "idle", revision: state.revision + 1, lease: state.lease }, effects: [{ type: "abort" }] };
    case "notifications-loaded":
      return state.phase === "visible" ? { state, effects: [{ type: "close-notifications" }] } : unchanged;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
