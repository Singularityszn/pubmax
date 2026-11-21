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

type EventOf<T extends ThreadPresenceEvent["type"]> = Extract<ThreadPresenceEvent, { type: T }>;
const PAUSED_EVENTS: ReadonlySet<ThreadPresenceEvent["type"]> = new Set(["restored", "depart", "stop", "ownership-lost"]);

function unchanged(state: ThreadPresenceState): Transition {
  return { state, effects: [] };
}

function accepts(state: ThreadPresenceState, event: ThreadPresenceEvent): boolean {
  if (state.phase === "stopped") return false;
  if ("revision" in event && event.revision !== state.revision) return false;
  return state.phase !== "paused" || PAUSED_EVENTS.has(event.type);
}

function hiddenSend(revision: number, lease: Lease): ThreadPresenceEffect {
  return { type: "send", revision, lease, visible: false };
}

function show(revision: number, lease: Lease): Transition {
  return { state: { phase: "visible", revision, lease }, effects: [{ type: "send", revision, lease, visible: true }] };
}

function idle(state: ThreadPresenceState): Transition {
  return { state: { phase: "idle", revision: state.revision, lease: state.lease }, effects: [] };
}

function expire(state: ThreadPresenceState): Transition {
  return { state: { phase: "idle", revision: state.revision + 1, lease: state.lease }, effects: [{ type: "abort" }] };
}

function refresh(state: ThreadPresenceState): Transition {
  if (state.phase === "loading" || state.phase === "reserving") return unchanged(state);
  const revision = state.revision + 1;
  return { state: { phase: "loading", revision, lease: state.lease, reuse: state.phase === "visible" }, effects: [{ type: "credentials", revision }] };
}

function leave(state: ThreadPresenceState, event: EventOf<"hide" | "depart" | "stop" | "ownership-lost">): Transition {
  if (event.type === "hide" && state.phase === "hidden") return unchanged(state);
  const revision = state.revision + 1;
  const context = { revision, lease: state.lease };
  return {
    state: event.type === "depart" ? { ...context, phase: "paused", departureRevision: event.departureRevision }
      : { ...context, phase: event.type === "hide" ? "hidden" : "stopped" },
    effects: [{ type: "abort" }, ...(state.lease && event.type !== "ownership-lost" ? [hiddenSend(revision, state.lease)] : [])],
  };
}

function restore(state: ThreadPresenceState, event: EventOf<"restored">): Transition {
  if (state.phase !== "paused" || event.departureRevision !== state.departureRevision || (state.lease && !sameBinding(state.lease, event))) return unchanged(state);
  return { state: { phase: "hidden", revision: state.revision + 1 }, effects: [] };
}

function receiveCredentials(state: ThreadPresenceState, event: EventOf<"credentials">): Transition {
  if (state.phase !== "loading") return unchanged(state);
  if (!event.binding) return idle(state);
  const same = state.lease && sameBinding(state.lease, event.binding);
  if (same && state.reuse && state.lease) return show(state.revision, { ...state.lease, ...event.binding });
  return {
    state: { phase: "reserving", revision: state.revision, binding: event.binding, lease: same ? state.lease : undefined },
    effects: [
      ...(state.lease && !same ? [hiddenSend(state.revision, state.lease)] : []),
      { type: "reserve", revision: state.revision, binding: event.binding },
    ],
  };
}

function receiveReservation(state: ThreadPresenceState, event: EventOf<"reserved">): Transition {
  if (state.phase !== "reserving") return unchanged(state);
  if (!validActivityId(event.activityId)) return idle(state);
  return show(state.revision, { ...state.binding, activityId: event.activityId });
}

function fail(state: ThreadPresenceState): Transition {
  return state.phase === "loading" || state.phase === "reserving" || state.phase === "visible" ? expire(state) : unchanged(state);
}

function deliver(state: ThreadPresenceState, event: EventOf<"delivered">): Transition {
  if (state.phase !== "visible") return unchanged(state);
  return event.applied ? { state, effects: [{ type: "notifications", revision: state.revision }] } : expire(state);
}

export function transitionThreadPresence(state: ThreadPresenceState, event: ThreadPresenceEvent): Transition {
  if (!accepts(state, event)) return unchanged(state);
  switch (event.type) {
    case "refresh": return refresh(state);
    case "hide":
    case "depart":
    case "stop":
    case "ownership-lost": return leave(state, event);
    case "restored": return restore(state, event);
    case "credentials": return receiveCredentials(state, event);
    case "reserved": return receiveReservation(state, event);
    case "failed": return fail(state);
    case "delivered": return deliver(state, event);
    case "notifications-loaded":
      return state.phase === "visible" ? { state, effects: [{ type: "close-notifications" }] } : unchanged(state);
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
