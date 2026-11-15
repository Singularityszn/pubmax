export type PlanRecoveryRecords = { session: Record<string, string | null>; local: Record<string, string | null> };
type PlanRecoveryCandidate = { records: PlanRecoveryRecords; requestId: string | null };
type Common = { owner: string | null; requestId: string | null; currentRequestId: string | null; otherRequestId: string | null; archived: PlanRecoveryCandidate[] };
type ReadyPlanRecovery = Common & { phase: "ready"; other: PlanRecoveryRecords };
type InterruptedPlanRecovery = Common & { other: PlanRecoveryRecords; before: PlanRecoveryRecords; target: PlanRecoveryRecords; rollback: ReadyPlanRecovery };
export type OnboardingAlternative = ReadyPlanRecovery
  | (InterruptedPlanRecovery & { phase: "pending" })
  | (InterruptedPlanRecovery & { phase: "deferred" });

export type PlanRecoveryEvent =
  | { type: "switch"; current: PlanRecoveryRecords; empty: PlanRecoveryRecords; requestId: string | null; fresh: boolean; initial?: boolean; archiveIndex?: number }
  | { type: "recover"; current: PlanRecoveryRecords; finish: boolean }
  | { type: "defer" }
  | { type: "review" };
export type PlanRecoveryEffect =
  | { type: "save"; value: OnboardingAlternative }
  | { type: "replace"; expected: PlanRecoveryRecords; target: PlanRecoveryRecords; staged: OnboardingAlternative; completed: OnboardingAlternative };

export function transitionPlanRecovery(state: OnboardingAlternative, event: PlanRecoveryEvent): { state: OnboardingAlternative; effect: PlanRecoveryEffect | null } {
  switch (event.type) {
    case "switch": {
      if (state.phase !== "ready") return { state, effect: null };
      const picked = event.archiveIndex === undefined ? null : state.archived[event.archiveIndex];
      if (event.archiveIndex !== undefined && !picked) return { state, effect: null };
      const fresh = event.fresh;
      const archived = fresh && !event.initial
        ? [...state.archived, { records: state.other, requestId: state.otherRequestId }]
        : [...state.archived];
      const target = fresh ? event.empty : picked?.records ?? state.other;
      if (picked && event.archiveIndex !== undefined) archived[event.archiveIndex] = { records: event.current, requestId: state.currentRequestId };
      const other = picked ? state.other : event.current;
      const common = {
        owner: state.owner, requestId: fresh ? event.requestId : state.requestId,
        currentRequestId: fresh ? event.requestId : picked ? picked.requestId : state.otherRequestId,
        otherRequestId: picked ? state.otherRequestId : state.currentRequestId, archived,
      };
      const staged: OnboardingAlternative = { ...common, phase: "pending", other, before: event.current, target, rollback: state };
      const completed: OnboardingAlternative = { ...common, phase: "ready", other };
      return { state: staged, effect: { type: "replace", expected: event.current, target, staged, completed } };
    }
    case "recover": {
      if (state.phase !== "pending") return { state, effect: null };
      const safe = (["session", "local"] as const).every((scope) => Object.keys(event.current[scope]).every((key) => event.current[scope][key] === state.before[scope][key] || event.current[scope][key] === state.target[scope][key]));
      if (!safe) return { state, effect: null };
      const target = event.finish ? state.target : state.before;
      const completed: OnboardingAlternative = event.finish
        ? { phase: "ready", owner: state.owner, requestId: state.requestId, currentRequestId: state.currentRequestId, otherRequestId: state.otherRequestId, archived: state.archived, other: state.other }
        : state.rollback;
      return { state, effect: { type: "replace", expected: event.current, target, staged: state, completed } };
    }
    case "defer": {
      if (state.phase !== "pending") return { state, effect: null };
      const next: OnboardingAlternative = { ...state, phase: "deferred" };
      return { state: next, effect: { type: "save", value: next } };
    }
    case "review": {
      if (state.phase !== "deferred") return { state, effect: null };
      const next: OnboardingAlternative = { ...state, phase: "pending" };
      return { state: next, effect: { type: "save", value: next } };
    }
    default: { const unreachable: never = event; return unreachable; }
  }
}
