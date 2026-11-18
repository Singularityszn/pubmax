export type MessagePushBinding = Readonly<{ token: string; sessionId: string }>;

type StorageTarget = "binding" | "releases";
export type MessagePushBindingState = (
  | { readonly phase: "unbound"; readonly revision: number; readonly pending: readonly [] }
  | { readonly phase: "bound"; readonly revision: number; readonly binding: MessagePushBinding; readonly pending: readonly MessagePushBinding[] }
  | { readonly phase: "departing"; readonly revision: number; readonly pending: readonly MessagePushBinding[] }
  | { readonly phase: "pending-release"; readonly revision: number; readonly pending: readonly [MessagePushBinding, ...MessagePushBinding[]] }
) & { readonly unsaved?: readonly StorageTarget[] };

export type MessagePushBindingEvent =
  | { type: "binding-recorded"; token: string; sessionId: string | null; revision: number; storedReleases?: readonly MessagePushBinding[] }
  | { type: "releases-loaded"; bindings: readonly MessagePushBinding[] }
  | { type: "release-confirmed"; binding: MessagePushBinding }
  | { type: "departure-started"; storedBinding: MessagePushBinding | null | undefined; storedReleases?: readonly MessagePushBinding[] }
  | { type: "departure-settled"; revision: number }
  | { type: "storage-result"; target: StorageTarget; saved: boolean };

export type MessagePushBindingEffect = "announce-departure" | "persist-binding" | "persist-releases";
export type MessagePushBindingTransition = { state: MessagePushBindingState; effects: readonly MessagePushBindingEffect[] };

export const INITIAL_MESSAGE_PUSH_BINDING_STATE: MessagePushBindingState = { phase: "unbound", revision: 0, pending: [] };

const key = (binding: MessagePushBinding) => `${binding.sessionId}:${binding.token}`;
function unique(bindings: readonly MessagePushBinding[]): MessagePushBinding[] {
  return [...new Map(bindings.map(binding => [key(binding), binding])).values()];
}
function detached(revision: number, pending: readonly MessagePushBinding[], unsaved?: readonly StorageTarget[]): MessagePushBindingState {
  const [first, ...rest] = pending;
  const state: MessagePushBindingState = first
    ? { phase: "pending-release", revision, pending: [first, ...rest] }
    : { phase: "unbound", revision, pending: [] };
  return unsaved?.length ? { ...state, unsaved } : state;
}
function withPending(state: MessagePushBindingState, pending: readonly MessagePushBinding[]): MessagePushBindingState {
  if (pending.length === state.pending.length && pending.every((binding, index) => key(binding) === key(state.pending[index]!))) return state;
  switch (state.phase) {
    case "bound":
    case "departing":
      return { ...state, pending };
    case "unbound":
    case "pending-release":
      return detached(state.revision, pending, state.unsaved);
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

function storageResult(state: MessagePushBindingState, event: Extract<MessagePushBindingEvent, { type: "storage-result" }>): MessagePushBindingState {
  if (Boolean(state.unsaved?.includes(event.target)) === !event.saved) return state;
  const { unsaved: previous = [], ...rest } = state;
  const unsaved = previous.filter(target => target !== event.target);
  if (!event.saved) unsaved.push(event.target);
  return unsaved.length ? { ...rest, unsaved } : rest;
}

export function transitionMessagePushBinding(state: MessagePushBindingState, event: MessagePushBindingEvent): MessagePushBindingTransition {
  switch (event.type) {
    case "binding-recorded": {
      const binding = event.sessionId ? { token: event.token, sessionId: event.sessionId } : null;
      const releases = state.unsaved?.includes("releases") ? state.pending : event.storedReleases ?? state.pending;
      if (event.revision !== state.revision) {
        if (!binding || (state.phase === "bound" && key(state.binding) === key(binding))) return { state, effects: [] };
        return { state: withPending(state, unique([...releases, binding])), effects: ["persist-releases"] };
      }
      const remaining = unique(releases).filter(item => item.token !== event.token);
      return {
        state: binding ? { ...(state.unsaved ? { unsaved: state.unsaved } : {}), phase: "bound", revision: state.revision, binding, pending: remaining } : detached(state.revision, remaining, state.unsaved),
        effects: ["persist-binding", "persist-releases"],
      };
    }
    case "releases-loaded":
      if (state.unsaved?.includes("releases")) return { state, effects: ["persist-releases"] };
      return { state: withPending(state, unique(event.bindings)), effects: [] };
    case "release-confirmed": {
      const pending = state.pending.filter(binding => key(binding) !== key(event.binding));
      if (pending.length === state.pending.length) return { state, effects: [] };
      return { state: withPending(state, pending), effects: ["persist-releases"] };
    }
    case "departure-started": {
      const binding = event.storedBinding === undefined || state.unsaved?.includes("binding") ? (state.phase === "bound" ? state.binding : null) : event.storedBinding;
      const releases = state.unsaved?.includes("releases") ? state.pending : event.storedReleases ?? state.pending;
      const pending = binding ? unique([...releases, binding]) : state.pending;
      const effects: MessagePushBindingEffect[] = ["announce-departure"];
      if (binding) effects.push("persist-releases");
      effects.push("persist-binding");
      return { state: { ...(state.unsaved ? { unsaved: state.unsaved } : {}), phase: "departing", revision: state.revision + 1, pending }, effects };
    }
    case "departure-settled":
      return state.phase === "departing" && event.revision === state.revision
        ? { state: detached(state.revision, state.pending, state.unsaved), effects: [] }
        : { state, effects: [] };
    case "storage-result":
      return { state: storageResult(state, event), effects: [] };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
