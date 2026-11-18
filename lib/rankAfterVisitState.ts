import type { RankSubject } from "@/lib/rankAfterVisitCheckpoint";
import type { SocialPubBand, SocialPubComparison, SocialPubRankingEntry } from "@/lib/socialPubRankings";

type VisitRankingScope = { venueId: string; accountRevision: number };
type VisitRankingList = { entries: SocialPubRankingEntry[]; subject: RankSubject | null };
export type VisitRankingRead = { kind: "entries"; list: VisitRankingList } | { kind: "refused" } | { kind: "unavailable" };
export type VisitRankingSave = {
  band: SocialPubBand;
  neighbours: { aboveVenueId: string | null; belowVenueId: string | null };
  shareRequested: boolean;
  uncertain: boolean;
};

type Context = VisitRankingScope & { requestId: number; asked: number; notice: string | null };
export type VisitRankingState = Context & (
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "refused" }
  | { kind: "band"; loaded: VisitRankingList }
  | { kind: "compare"; loaded: VisitRankingList; band: SocialPubBand; session: SocialPubComparison }
  | { kind: "saving"; loaded: VisitRankingList }
  | { kind: "checking"; loaded: VisitRankingList; pending: VisitRankingSave }
  | { kind: "recover"; loaded: VisitRankingList; pending: VisitRankingSave }
  | { kind: "done"; loaded: VisitRankingList; shared: boolean | null }
);

export type VisitRankingEventInput =
  | { type: "read"; requestId: number; result: VisitRankingRead }
  | { type: "retry" }
  | { type: "compare"; band: SocialPubBand; session: SocialPubComparison }
  | { type: "answer"; session: SocialPubComparison }
  | { type: "save" }
  | { type: "saved"; requestId: number; entries: SocialPubRankingEntry[]; shared: boolean | null }
  | { type: "rejected"; requestId: number; notice: string }
  | { type: "refused"; requestId: number }
  | { type: "check"; pending: VisitRankingSave };
export type VisitRankingEvent = VisitRankingScope & VisitRankingEventInput;

function context(state: VisitRankingState): Context {
  return { venueId: state.venueId, accountRevision: state.accountRevision, requestId: state.requestId,
    asked: state.asked, notice: state.notice };
}

export function startVisitRanking(scope: VisitRankingScope): VisitRankingState {
  return { ...scope, kind: "loading", requestId: 0, asked: 0, notice: null };
}

export function visitRankingBusy(state: VisitRankingState): boolean {
  switch (state.kind) {
    case "loading": case "saving": case "checking": return true;
    case "unavailable": case "refused": case "band": case "compare": case "recover": case "done": return false;
    default: { const unreachable: never = state; return unreachable; }
  }
}

function recoveredCheckpoint(state: Extract<VisitRankingState, { kind: "checking" }>, fresh: VisitRankingList) {
  const loaded = { ...fresh, subject: fresh.subject ?? state.loaded.subject };
  const venueId = state.loaded.subject?.venueId ?? state.venueId;
  const { pending } = state;
  const ids = loaded.entries.filter((entry) => entry.band === pending.band).map((entry) => entry.venueId);
  const position = ids.indexOf(venueId);
  const confirmed = pending.uncertain && position !== -1 &&
    (ids[position - 1] ?? null) === pending.neighbours.aboveVenueId &&
    (ids[position + 1] ?? null) === pending.neighbours.belowVenueId;
  const notice = confirmed
    ? pending.shareRequested ? "We could not confirm whether your lot saw it." : null
    : pending.uncertain ? "Your list is checked. Choose how to rank it again." : "Your list changed in another tab. One more go.";
  return { loaded, confirmed, notice };
}

export function transitionVisitRanking(state: VisitRankingState, event: VisitRankingEvent, comparisonLimit: number): VisitRankingState {
  if (state.venueId !== event.venueId || state.accountRevision !== event.accountRevision || state.kind === "refused") return state;
  if ("requestId" in event && event.requestId !== state.requestId) return state;
  const base = context(state);
  switch (event.type) {
    case "read": {
      if (state.kind !== "loading" && state.kind !== "checking") return state;
      switch (event.result.kind) {
        case "refused": return { ...base, kind: "refused", notice: null };
        case "unavailable": return state.kind === "checking"
          ? { ...base, kind: "recover", loaded: state.loaded, pending: state.pending }
          : { ...base, kind: "unavailable" };
        case "entries": {
          if (state.kind === "loading") return { ...base, kind: "band", loaded: event.result.list, notice: null };
          const { loaded, confirmed, notice } = recoveredCheckpoint(state, event.result.list);
          return confirmed ? { ...base, kind: "done", loaded, shared: null, notice }
            : { ...base, kind: "band", loaded, notice };
        }
        default: { const unreachable: never = event.result; return unreachable; }
      }
    }
    case "retry": return state.kind === "unavailable"
      ? { ...base, kind: "loading", requestId: state.requestId + 1, notice: null } : state;
    case "compare": return state.kind === "band"
      ? { ...base, kind: "compare", loaded: state.loaded, band: event.band, session: event.session, notice: null } : state;
    case "answer": return state.kind === "compare" && state.asked < comparisonLimit
      ? { ...state, session: event.session, asked: state.asked + 1 } : state;
    case "save": return state.kind === "band" || state.kind === "compare"
      ? { ...base, kind: "saving", loaded: state.loaded, requestId: state.requestId + 1, notice: null } : state;
    case "saved": return state.kind === "saving"
      ? { ...base, kind: "done", loaded: { entries: event.entries, subject: state.loaded.subject }, shared: event.shared } : state;
    case "rejected": return state.kind === "saving"
      ? { ...base, kind: "band", loaded: state.loaded, notice: event.notice } : state;
    case "refused": return state.kind === "saving" ? { ...base, kind: "refused", notice: null } : state;
    case "check": return state.kind === "saving" || state.kind === "recover"
      ? { ...base, kind: "checking", loaded: state.loaded, pending: event.pending,
        requestId: state.requestId + 1, notice: null } : state;
    default: { const unreachable: never = event; return unreachable; }
  }
}
