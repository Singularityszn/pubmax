import { PLAN_DRAFT_KEY, PLAN_DRAFT_V2_KEY, PLAN_INTAKE_STORAGE_KEY, PLAN_ONBOARDING_ALTERNATIVE_KEY, PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY } from "@/lib/planDraftStorage";
import { PLANNING_INTENT_STORAGE_KEY } from "@/lib/planningIntent";

const KEY = PLAN_ONBOARDING_ALTERNATIVE_KEY;
const SESSION_KEYS = [PLAN_DRAFT_KEY, PLAN_DRAFT_V2_KEY, PLANNING_INTENT_STORAGE_KEY] as const;
const LOCAL_KEYS = [PLAN_INTAKE_STORAGE_KEY, PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY] as const;
type Records = { session: Record<string, string | null>; local: Record<string, string | null> };
export type OnboardingAlternative = { owner: string | null; active: "old" | "new"; other: Records; pending?: Records };

export function hasOnboardingAlternative(session: Storage | null): boolean {
  try { return Boolean(session?.getItem(KEY)); } catch { return false; }
}

function readRecords(session: Storage, local: Storage): Records {
  return {
    session: Object.fromEntries(SESSION_KEYS.map((key) => [key, session.getItem(key)])),
    local: Object.fromEntries(LOCAL_KEYS.map((key) => [key, local.getItem(key)])),
  };
}

function writeRecords(records: Records, session: Storage, local: Storage, expected?: Records): void {
  for (const [store, keys, values, prior] of [[session, SESSION_KEYS, records.session, expected?.session], [local, LOCAL_KEYS, records.local, expected?.local]] as const) {
    for (const key of keys) {
      const value = values[key];
      if (value === undefined) throw new Error("Missing saved plan value");
      if (prior && store.getItem(key) !== prior[key]) throw new Error("The saved plan changed");
      if (value === null) store.removeItem(key);
      else store.setItem(key, value);
      if (store.getItem(key) !== value) throw new Error("Plan storage did not retain the change");
    }
  }
}

export function readOnboardingAlternative(session: Storage | null, owner: string | null): OnboardingAlternative | null {
  try {
    const value = JSON.parse(session?.getItem(KEY) ?? "null") as OnboardingAlternative | null;
    if (!value || value.owner !== owner || (value.active !== "old" && value.active !== "new")) return null;
    const valid = (records: Records) => records && records.session && records.local
      && [...SESSION_KEYS.map((key) => records.session[key]), ...LOCAL_KEYS.map((key) => records.local[key])]
        .every((item) => item === null || typeof item === "string");
    if (!valid(value.other) || (value.pending !== undefined && !valid(value.pending))) return null;
    return value;
  } catch { return null; }
}

/** Save both sides before replacing the active records. A failed write restores them. */
export function switchOnboardingPlan(session: Storage | null, local: Storage | null, owner: string | null): boolean {
  if (!session || !local) return false;
  let current: Records;
  let previous: string | null;
  try {
    current = readRecords(session, local);
    previous = session.getItem(KEY);
    const alternative = readOnboardingAlternative(session, owner);
    if (previous && (!alternative || alternative.pending)) return false;
    const next: OnboardingAlternative = { owner, active: alternative?.active === "new" ? "old" : "new", other: current };
    const target = alternative?.other ?? {
      session: Object.fromEntries(SESSION_KEYS.map((key) => [key, null])),
      local: Object.fromEntries(LOCAL_KEYS.map((key) => [key, null])),
    };
    session.setItem(KEY, JSON.stringify({ ...next, pending: target }));
    if (!readOnboardingAlternative(session, owner)) throw new Error("Could not save the previous plan");
    try {
      writeRecords(target, session, local, current);
      session.setItem(KEY, JSON.stringify(next));
    } catch (error) {
      recoverOnboardingSwitch(session, local, owner, false);
      throw error;
    }
    return true;
  } catch { return false; }
}

/** Finish or reverse an interrupted switch without throwing away either side. */
export function recoverOnboardingSwitch(session: Storage | null, local: Storage | null, owner: string | null, finish: boolean): boolean {
  if (!session || !local) return false;
  const alternative = readOnboardingAlternative(session, owner);
  if (!alternative?.pending) return false;
  try {
    const current = readRecords(session, local);
    const safe = (["session", "local"] as const).every((scope) =>
      Object.keys(current[scope]).every((key) => current[scope][key] === alternative.other[scope][key]
        || current[scope][key] === alternative.pending![scope][key]));
    if (!safe) return false;
    writeRecords(finish ? alternative.pending : alternative.other, session, local, current);
    session.setItem(KEY, JSON.stringify({
      owner,
      active: finish ? alternative.active : alternative.active === "new" ? "old" : "new",
      other: finish ? alternative.other : alternative.pending,
    } satisfies OnboardingAlternative));
    return true;
  } catch { return false; }
}
