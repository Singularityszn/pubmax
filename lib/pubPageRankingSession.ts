import type { SocialPubRankingEntry } from "@/lib/socialPubRankings";

type Checkpoint = SocialPubRankingEntry | null;
type Scope = { scope: string; venueId: string; requestId: number; checkpoint: Checkpoint };

export type PubPageRankingRead =
  | { kind: "entries"; entries: SocialPubRankingEntry[] }
  | { kind: "failed"; message: string }
  | { kind: "refused"; message: string };

export type PubPageRankingState = Scope & (
  | { kind: "idle" }
  | { kind: "closed" }
  | { kind: "loading"; origin: "open" }
  | { kind: "loading"; origin: "closed"; pendingWrite: Promise<void> }
  | { kind: "failed"; message: string }
  | { kind: "refused"; message: string; checkpoint: null }
  | { kind: "comparing"; entries: SocialPubRankingEntry[] }
);

type ScopedEvent = { scope: string; requestId: number };
export type PubPageRankingEvent =
  | { type: "open" }
  | (ScopedEvent & { type: "read"; result: PubPageRankingRead })
  | (ScopedEvent & { type: "saved"; entries: SocialPubRankingEntry[] })
  | (ScopedEvent & { type: "close"; pendingWrite?: Promise<void> })
  | (ScopedEvent & { type: "refused"; message: string });

export function initialPubPageRanking(scope: string, venueId: string): PubPageRankingState {
  return { kind: "idle", scope, venueId, requestId: 0, checkpoint: null };
}

function context(state: PubPageRankingState): Scope {
  return { scope: state.scope, venueId: state.venueId, requestId: state.requestId, checkpoint: state.checkpoint };
}

function matches(state: PubPageRankingState, event: ScopedEvent): boolean {
  return state.scope === event.scope && state.requestId === event.requestId;
}

export function transitionPubPageRanking(state: PubPageRankingState, event: PubPageRankingEvent): PubPageRankingState {
  switch (event.type) {
    case "open":
      if (state.kind === "loading" || state.kind === "comparing") return state;
      return { ...context(state), kind: "loading", origin: "open", requestId: state.requestId + 1 };
    case "read": {
      if (state.kind !== "loading" || !matches(state, event)) return state;
      switch (event.result.kind) {
        case "entries": {
          const checkpoint = event.result.entries.find((entry) => entry.venueId === state.venueId) ?? null;
          return state.origin === "open"
            ? { ...context(state), kind: "comparing", entries: event.result.entries, checkpoint }
            : { ...context(state), kind: "idle", checkpoint };
        }
        case "failed":
          return { ...context(state), kind: "failed", message: event.result.message };
        case "refused":
          return { ...context(state), kind: "refused", message: event.result.message, checkpoint: null };
        default: {
          const unreachable: never = event.result;
          return unreachable;
        }
      }
    }
    case "saved": {
      if ((state.kind !== "comparing" && state.kind !== "closed") || !matches(state, event)) return state;
      const checkpoint = event.entries.find((entry) => entry.venueId === state.venueId) ?? null;
      return state.kind === "closed"
        ? { ...context(state), kind: "idle", checkpoint, requestId: state.requestId + 1 }
        : { ...context(state), kind: "comparing", entries: event.entries, checkpoint };
    }
    case "close":
      if (state.kind !== "comparing" || !matches(state, event)) return state;
      return event.pendingWrite
        ? { ...context(state), kind: "loading", origin: "closed", pendingWrite: event.pendingWrite, requestId: state.requestId + 1 }
        : { ...context(state), kind: "closed" };
    case "refused":
      if (state.kind !== "comparing" || !matches(state, event)) return state;
      return { ...context(state), kind: "refused", message: event.message, checkpoint: null };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
