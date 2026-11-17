export type MessagePushBinding = Readonly<{ token: string; sessionId: string }>;

export type MessagePushBindingState =
  | { readonly phase: "unbound"; readonly revision: number; readonly pending: readonly [] }
  | { readonly phase: "bound"; readonly revision: number; readonly binding: MessagePushBinding; readonly pending: readonly MessagePushBinding[] }
  | { readonly phase: "departing"; readonly revision: number; readonly pending: readonly MessagePushBinding[] }
  | { readonly phase: "pending-release"; readonly revision: number; readonly pending: readonly [MessagePushBinding, ...MessagePushBinding[]] };

export type MessagePushBindingEvent =
  | { type: "binding-recorded"; token: string; sessionId: string | null; revision: number; storedReleases?: readonly MessagePushBinding[] }
  | { type: "releases-loaded"; bindings: readonly MessagePushBinding[] }
  | { type: "release-confirmed"; binding: MessagePushBinding }
  | { type: "departure-started"; storedBinding: MessagePushBinding | null | undefined; storedReleases?: readonly MessagePushBinding[] }
  | { type: "departure-settled"; revision: number };

export type MessagePushBindingEffect = "announce-departure" | "persist-binding" | "persist-releases";
export type MessagePushBindingTransition = { state: MessagePushBindingState; effects: readonly MessagePushBindingEffect[] };

export const INITIAL_MESSAGE_PUSH_BINDING_STATE: MessagePushBindingState = { phase: "unbound", revision: 0, pending: [] };

const key = (binding: MessagePushBinding) => `${binding.sessionId}:${binding.token}`;
function unique(bindings: readonly MessagePushBinding[]): MessagePushBinding[] {
  return [...new Map(bindings.map(binding => [key(binding), binding])).values()];
}
function detached(revision: number, pending: readonly MessagePushBinding[]): MessagePushBindingState {
  const [first, ...rest] = pending;
  return first
    ? { phase: "pending-release", revision, pending: [first, ...rest] }
    : { phase: "unbound", revision, pending: [] };
}
function withPending(state: MessagePushBindingState, pending: readonly MessagePushBinding[]): MessagePushBindingState {
  switch (state.phase) {
    case "bound":
    case "departing":
      return { ...state, pending };
    case "unbound":
    case "pending-release":
      return detached(state.revision, pending);
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

export function transitionMessagePushBinding(state: MessagePushBindingState, event: MessagePushBindingEvent): MessagePushBindingTransition {
  switch (event.type) {
    case "binding-recorded": {
      const binding = event.sessionId ? { token: event.token, sessionId: event.sessionId } : null;
      if (event.revision !== state.revision) {
        if (!binding) return { state, effects: [] };
        return { state: withPending(state, unique([...(event.storedReleases ?? state.pending), binding])), effects: ["persist-releases"] };
      }
      const remaining = unique(event.storedReleases ?? state.pending).filter(item => item.token !== event.token);
      return {
        state: binding ? { phase: "bound", revision: state.revision, binding, pending: remaining } : detached(state.revision, remaining),
        effects: ["persist-binding", "persist-releases"],
      };
    }
    case "releases-loaded":
      return { state: withPending(state, unique(event.bindings)), effects: [] };
    case "release-confirmed": {
      const pending = state.pending.filter(binding => key(binding) !== key(event.binding));
      if (pending.length === state.pending.length) return { state, effects: [] };
      return { state: withPending(state, pending), effects: ["persist-releases"] };
    }
    case "departure-started": {
      const binding = event.storedBinding === undefined ? (state.phase === "bound" ? state.binding : null) : event.storedBinding;
      const pending = binding ? unique([...(event.storedReleases ?? state.pending), binding]) : state.pending;
      const effects: MessagePushBindingEffect[] = ["announce-departure"];
      if (binding) effects.push("persist-releases");
      effects.push("persist-binding");
      return { state: { phase: "departing", revision: state.revision + 1, pending }, effects };
    }
    case "departure-settled":
      return state.phase === "departing" && event.revision === state.revision
        ? { state: detached(state.revision, state.pending), effects: [] }
        : { state, effects: [] };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
