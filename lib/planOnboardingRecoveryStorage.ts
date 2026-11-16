import { PLAN_DRAFT_KEY, PLAN_DRAFT_V2_KEY, PLAN_INTAKE_STORAGE_KEY, PLAN_ONBOARDING_ALTERNATIVE_KEY, PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY } from "@/lib/planDraftStorage";
import { PLANNING_INTENT_STORAGE_KEY } from "@/lib/planningIntent";
import { transitionPlanRecovery, type OnboardingAlternative, type PlanRecoveryRecords } from "@/lib/planOnboardingRecovery";

const KEY = PLAN_ONBOARDING_ALTERNATIVE_KEY;
const SESSION_KEYS = [PLAN_DRAFT_KEY, PLAN_DRAFT_V2_KEY, PLANNING_INTENT_STORAGE_KEY] as const;
const LOCAL_KEYS = [PLAN_INTAKE_STORAGE_KEY, PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY] as const;
function serialize(value: OnboardingAlternative): string { return JSON.stringify({ version: 3, ...value }); }
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
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function requestId(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
function valid(records: unknown): records is PlanRecoveryRecords {
  if (!record(records) || !record(records.session) || !record(records.local)) return false;
  const session = records.session;
  const local = records.local;
  return [...SESSION_KEYS.map((key) => session[key]), ...LOCAL_KEYS.map((key) => local[key])]
    .every((item) => item === null || typeof item === "string");
}
function readReady(value: unknown, owner: string | null, legacy: boolean): Extract<OnboardingAlternative, { phase: "ready" }> | null {
  if (!record(value) || value.owner !== owner || !valid(value.other)) return null;
  if (legacy && value.active !== "old" && value.active !== "new") return null;
  const ids = legacy
    ? { requestId: null, currentRequestId: null, otherRequestId: null }
    : { requestId: value.requestId, currentRequestId: value.currentRequestId, otherRequestId: value.otherRequestId };
  if (!requestId(ids.requestId) || !requestId(ids.currentRequestId) || !requestId(ids.otherRequestId)) return null;
  const entries = legacy && value.archived === undefined ? [] : value.archived;
  if (!Array.isArray(entries)) return null;
  const archived = [];
  for (const candidate of entries) {
    if (!record(candidate) || !valid(candidate.records)) return null;
    const id = legacy ? null : candidate.requestId;
    if (!requestId(id)) return null;
    archived.push({ records: candidate.records, requestId: id });
  }
  return { phase: "ready", owner, requestId: ids.requestId, currentRequestId: ids.currentRequestId, otherRequestId: ids.otherRequestId, other: value.other, archived };
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
    const raw: unknown = JSON.parse(session?.getItem(KEY) ?? "null");
    if (!record(raw) || (raw.version !== undefined && raw.version !== 2 && raw.version !== 3)) return null;
    const legacy = raw.version !== 3;
    const base = readReady(raw, owner, legacy);
    if (!base) return null;
    if (raw.version === undefined && !raw.phase) {
      if (!raw.pending) return base;
      if (!valid(raw.pending)) return null;
      return { ...base, phase: "pending", before: base.other, target: raw.pending, rollback: { ...base, other: raw.pending } };
    }
    if (raw.phase === "ready") return base;
    if ((raw.phase !== "pending" && raw.phase !== "deferred") || !valid(raw.before) || !valid(raw.target)
      || !record(raw.rollback) || raw.rollback.phase !== "ready") return null;
    const rollback = readReady(raw.rollback, owner, legacy);
    return rollback ? { ...base, phase: raw.phase, before: raw.before, target: raw.target, rollback } : null;
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
    const state: OnboardingAlternative = existing ?? { phase: "ready", owner, requestId: null, currentRequestId: null, otherRequestId: null, other: empty, archived: [] };
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
