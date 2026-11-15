import { PLAN_DRAFT_KEY, PLAN_DRAFT_V2_KEY, PLAN_INTAKE_STORAGE_KEY, PLAN_ONBOARDING_ALTERNATIVE_KEY, PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY } from "@/lib/planDraftStorage";
import { PLANNING_INTENT_STORAGE_KEY } from "@/lib/planningIntent";
import { transitionPlanRecovery, type OnboardingAlternative, type PlanRecoveryRecords } from "@/lib/planOnboardingRecovery";

const KEY = PLAN_ONBOARDING_ALTERNATIVE_KEY;
const SESSION_KEYS = [PLAN_DRAFT_KEY, PLAN_DRAFT_V2_KEY, PLANNING_INTENT_STORAGE_KEY] as const;
const LOCAL_KEYS = [PLAN_INTAKE_STORAGE_KEY, PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY] as const;
function serialize(value: OnboardingAlternative): string { return JSON.stringify({ version: 2, ...value }); }
function writeState(session: Storage, value: OnboardingAlternative): void {
  const encoded = serialize(value);
  session.setItem(KEY, encoded);
  if (session.getItem(KEY) !== encoded) throw new Error("Plan storage did not retain the change");
}
export function hasOnboardingAlternative(session: Storage | null): boolean {
  try { return Boolean(session?.getItem(KEY)); } catch { return false; }
}
function readRecords(session: Storage, local: Storage): PlanRecoveryRecords {
  return { session: Object.fromEntries(SESSION_KEYS.map((key) => [key, session.getItem(key)])), local: Object.fromEntries(LOCAL_KEYS.map((key) => [key, local.getItem(key)])) };
}
function emptyRecords(): PlanRecoveryRecords {
  return { session: Object.fromEntries(SESSION_KEYS.map((key) => [key, null])), local: Object.fromEntries(LOCAL_KEYS.map((key) => [key, null])) };
}
function valid(records: PlanRecoveryRecords): boolean {
  return Boolean(records && records.session && records.local && [...SESSION_KEYS.map((key) => records.session[key]), ...LOCAL_KEYS.map((key) => records.local[key])].every((item) => item === null || typeof item === "string"));
}
function writeRecords(records: PlanRecoveryRecords, session: Storage, local: Storage, expected: PlanRecoveryRecords): void {
  for (const [store, keys, values, prior] of [[session, SESSION_KEYS, records.session, expected.session], [local, LOCAL_KEYS, records.local, expected.local]] as const) {
    for (const key of keys) {
      const value = values[key];
      if (value === undefined || store.getItem(key) !== prior[key]) throw new Error("The saved plan changed");
      if (value === null) store.removeItem(key); else store.setItem(key, value);
      if (store.getItem(key) !== value) throw new Error("Plan storage did not retain the change");
    }
  }
}
export function readOnboardingAlternative(session: Storage | null, owner: string | null): OnboardingAlternative | null {
  try {
    const raw = JSON.parse(session?.getItem(KEY) ?? "null");
    if (!raw || (raw.version !== undefined && raw.version !== 2) || raw.owner !== owner || (raw.active !== "old" && raw.active !== "new") || !valid(raw.other)) return null;
    const common = { owner, active: raw.active as "old" | "new", requestId: typeof raw.requestId === "string" ? raw.requestId : null, archived: Array.isArray(raw.archived) ? raw.archived : [] };
    if (!common.archived.every((candidate: { records: PlanRecoveryRecords }) => valid(candidate?.records))) return null;
    if (!raw.phase && raw.version === undefined) {
      if (!raw.pending) return { ...common, phase: "ready", other: raw.other };
      if (!valid(raw.pending)) return null;
      return { ...common, phase: "pending", other: raw.other, before: raw.other, target: raw.pending, rollback: { ...common, phase: "ready", active: raw.active === "new" ? "old" : "new", other: raw.pending } };
    }
    if (raw.phase === "ready") return { ...common, phase: "ready", other: raw.other };
    if ((raw.phase !== "pending" && raw.phase !== "deferred") || !valid(raw.before) || !valid(raw.target) || !raw.rollback || raw.rollback.phase !== "ready" || raw.rollback.owner !== owner || (raw.rollback.active !== "old" && raw.rollback.active !== "new") || !valid(raw.rollback.other) || !Array.isArray(raw.rollback.archived) || !raw.rollback.archived.every((candidate: { records: PlanRecoveryRecords }) => valid(candidate?.records))) return null;
    return { ...common, phase: raw.phase, other: raw.other, before: raw.before, target: raw.target, rollback: raw.rollback };
  } catch { return null; }
}
function execute(session: Storage, local: Storage, effect: ReturnType<typeof transitionPlanRecovery>["effect"]): boolean {
  if (!effect) return false;
  try {
    if (effect.type === "save") { writeState(session, effect.value); return true; }
    writeState(session, effect.staged);
    if (!readOnboardingAlternative(session, effect.staged.owner)) return false;
    writeRecords(effect.target, session, local, effect.expected);
    writeState(session, effect.completed);
    return true;
  } catch { return false; }
}
export function switchOnboardingPlan(session: Storage | null, local: Storage | null, owner: string | null, requestId: string | null = null, fresh = false, archiveIndex?: number): boolean {
  if (!session || !local) return false;
  try {
    const previous = session.getItem(KEY);
    const existing = readOnboardingAlternative(session, owner);
    if (previous && !existing) return false;
    const empty = emptyRecords();
    const state: OnboardingAlternative = existing ?? { phase: "ready", owner, active: "old", requestId: null, other: empty, archived: [] };
    const transition = transitionPlanRecovery(state, { type: "switch", current: readRecords(session, local), empty, requestId, fresh: !existing || fresh, initial: !existing, archiveIndex });
    const ok = execute(session, local, transition.effect);
    if (!ok) recoverOnboardingSwitch(session, local, owner, false);
    return ok;
  } catch { return false; }
}
export function recoverOnboardingSwitch(session: Storage | null, local: Storage | null, owner: string | null, finish: boolean): boolean {
  if (!session || !local) return false;
  try {
    const state = readOnboardingAlternative(session, owner);
    return Boolean(state && execute(session, local, transitionPlanRecovery(state, { type: "recover", current: readRecords(session, local), finish }).effect));
  } catch { return false; }
}
export function deferOnboardingSwitch(session: Storage | null, owner: string | null, review = false): boolean {
  if (!session) return false;
  const state = readOnboardingAlternative(session, owner);
  if (!state) return false;
  const effect = transitionPlanRecovery(state, { type: review ? "review" : "defer" }).effect;
  if (!effect || effect.type !== "save") return false;
  try { writeState(session, effect.value); return true; } catch { return false; }
}
