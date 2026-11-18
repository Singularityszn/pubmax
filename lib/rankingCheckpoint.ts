// A private ranking read that keeps its last confirmed checkpoint, as one
// machine (docs/rules/state-machines.md). The Social panel and the owner's
// profile both hold one. A refusal always wins and drops what was held. An
// outage keeps the held list. A save the server confirmed is the checkpoint
// at once. Every read is a request, and its answer names that request: a
// late answer for an older one changes nothing.

/** The comparison dialog over this list: shut, open, or open with a confirmed save. */
type RankingSession = "none" | "open" | "saved";

export type RankingCheckpoint<T> =
  | { phase: "reading"; request: number; session: RankingSession; kept: T | null; retrying: boolean; fromSession: boolean }
  | { phase: "ready"; request: number; session: RankingSession; data: T; afterRetry: boolean }
  | { phase: "unavailable"; request: number; session: RankingSession; kept: T | null }
  /** `retired`: the refusal reached a reader inside the section, so its heading stays for their focus. */
  | { phase: "refused"; request: number; retired: boolean };

export type RankingReadOutcome<T> =
  | { kind: "data"; data: T }
  | { kind: "unavailable" }
  | { kind: "refused"; readerInside: boolean };

export type RankingCheckpointEvent<T> =
  /** Read again: a retry, a new scope, or a refresh from outside. */
  | { type: "read"; retrying: boolean }
  | { type: "answered"; request: number; outcome: RankingReadOutcome<T> }
  | { type: "session_opened" }
  | { type: "session_saved"; data: T }
  /** `refresh`: the dialog left something only a read can settle. */
  | { type: "session_closed"; refresh: boolean; refused: boolean };

export function startRankingCheckpoint<T>(): RankingCheckpoint<T> {
  return { phase: "reading", request: 1, session: "none", kept: null, retrying: false, fromSession: false };
}

/** The list this checkpoint can show: confirmed, or kept through a read or an outage. */
export function heldRanking<T>(state: RankingCheckpoint<T>): T | null {
  switch (state.phase) {
    case "ready":
      return state.data;
    case "reading":
    case "unavailable":
      return state.kept;
    case "refused":
      return null;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

/** A read the reader asked for again, while it is out. */
export function retryingRanking<T>(state: RankingCheckpoint<T>): boolean {
  return state.phase === "reading" && state.retrying;
}

/** The request whose retry just answered with a list: its heading takes focus once. */
export function retryFocusRequest<T>(state: RankingCheckpoint<T>): number | null {
  return state.phase === "ready" && state.afterRetry ? state.request : null;
}

/** The refusal that reached a reader inside the section: its heading takes focus once. */
export function retiredFocusRequest<T>(state: RankingCheckpoint<T>): number | null {
  return state.phase === "refused" && state.retired ? state.request : null;
}

function refused<T>(state: RankingCheckpoint<T>, retired: boolean): RankingCheckpoint<T> {
  return { phase: "refused", request: state.request + 1, retired };
}

export function transitionRankingCheckpoint<T>(state: RankingCheckpoint<T>, event: RankingCheckpointEvent<T>): RankingCheckpoint<T> {
  switch (event.type) {
    case "read":
      return {
        phase: "reading",
        request: state.request + 1,
        session: state.phase === "refused" ? "none" : state.session,
        kept: heldRanking(state),
        retrying: event.retrying,
        fromSession: false,
      };
    case "answered": {
      if (state.phase === "refused" || event.request !== state.request) return state;
      const outcome = event.outcome;
      switch (outcome.kind) {
        case "refused":
          return { phase: "refused", request: state.request, retired: outcome.readerInside || (state.phase === "reading" && state.fromSession) };
        case "data":
          return state.phase === "reading"
            ? { phase: "ready", request: state.request, session: state.session, data: outcome.data, afterRetry: state.retrying }
            : state;
        case "unavailable":
          return state.phase === "reading"
            ? { phase: "unavailable", request: state.request, session: state.session, kept: state.kept }
            : state;
        default: {
          const unreachable: never = outcome;
          return unreachable;
        }
      }
    }
    case "session_opened":
      return state.phase === "ready" && state.session === "none" ? { ...state, session: "open" } : state;
    case "session_saved":
      // The server's own answer is newer than any read still out, so those are dropped.
      return state.phase === "refused"
        ? state
        : { phase: "ready", request: state.request + 1, session: "saved", data: event.data, afterRetry: false };
    case "session_closed": {
      if (state.phase === "refused") return state;
      if (event.refused) return refused(state, true);
      if (!event.refresh && state.phase === "ready" && state.session === "saved") return { ...state, session: "none" };
      return { phase: "reading", request: state.request + 1, session: "none", kept: heldRanking(state), retrying: false, fromSession: true };
    }
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
