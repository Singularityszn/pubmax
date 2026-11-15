import { describe, expect, it } from "vitest";
import { readOnboardingAlternative, recoverOnboardingSwitch, switchOnboardingPlan } from "@/lib/planOnboardingRecoveryStorage";
import { PLAN_DRAFT_KEY, PLAN_INTAKE_STORAGE_KEY, PLAN_ONBOARDING_ALTERNATIVE_KEY, PLAN_DRAFT_V2_KEY, PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY } from "@/lib/planDraftStorage";
import { PLANNING_INTENT_STORAGE_KEY } from "@/lib/planningIntent";
import { bindDeviceAccountOwner, clearDeviceAccountSessionArtifacts, DEVICE_ACCOUNT_OWNER_KEY } from "@/lib/deviceAccountIdentity";
import { transitionPlanRecovery, type OnboardingAlternative } from "@/lib/planOnboardingRecovery";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
  };
}

describe("switching onboarding plans", () => {
  it.each([undefined, 2])("preserves version %s candidates without guessing request ownership", (version) => {
    const session = storage();
    const local = storage();
    const records = { session: { [PLAN_DRAFT_KEY]: "old private plan", [PLAN_DRAFT_V2_KEY]: null, [PLANNING_INTENT_STORAGE_KEY]: null }, local: { [PLAN_INTAKE_STORAGE_KEY]: null, [PLAN_ROUTE_DRAFT_KEY]: null, [PLAN_ROUTE_DRAFT_V2_KEY]: null } };
    session.setItem(PLAN_ONBOARDING_ALTERNATIVE_KEY, JSON.stringify({ version, phase: version === 2 ? "ready" : undefined, owner: "a", active: "new", requestId: "unproven prior request", other: records }));
    session.setItem(PLAN_DRAFT_KEY, "current plan");
    expect(readOnboardingAlternative(session, "a")).toMatchObject({ requestId: null, currentRequestId: null, otherRequestId: null });
    expect(switchOnboardingPlan(session, local, "b", "Camden", true)).toBe(false);
    expect(switchOnboardingPlan(session, local, "a", "Camden", true)).toBe(true);
    const recovered = readOnboardingAlternative(session, "a");
    expect(recovered?.requestId).toBe("Camden");
    expect(recovered?.other.session[PLAN_DRAFT_KEY]).toBe("current plan");
    expect(recovered?.archived[0]?.records.session[PLAN_DRAFT_KEY]).toBe("old private plan");
  });

  it("refuses an incomplete saved candidate without changing current records", () => {
    const session = storage();
    const local = storage();
    session.setItem(PLAN_DRAFT_KEY, "current request");
    local.setItem(PLAN_INTAKE_STORAGE_KEY, "current access");
    session.setItem(PLAN_ONBOARDING_ALTERNATIVE_KEY, JSON.stringify({ owner: null, active: "new", other: { session: {}, local: {} } }));
    expect(switchOnboardingPlan(session, local, null)).toBe(false);
    expect(session.getItem(PLAN_DRAFT_KEY)).toBe("current request");
    expect(local.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe("current access");
  });
  it("defers a conflicting switch, refuses recovery, and returns it to review without dropping candidates", () => {
    const before = { session: { draft: "before" }, local: { intake: "before" } };
    const target = { session: { draft: "target" }, local: { intake: "target" } };
    const ready: OnboardingAlternative = { phase: "ready", owner: null, requestId: "Soho", currentRequestId: null, otherRequestId: "Soho", other: target, archived: [] };
    const switched = transitionPlanRecovery(ready, { type: "switch", current: before, empty: target, requestId: "Soho", fresh: false });
    expect(switched.state.phase).toBe("pending");
    const changed = { session: { draft: "before" }, local: { intake: "another tab" } };
    const refused = transitionPlanRecovery(switched.state, { type: "recover", current: changed, finish: true });
    expect(refused.state).toBe(switched.state);
    expect(refused.effect).toBeNull();
    const deferred = transitionPlanRecovery(switched.state, { type: "defer" });
    expect(deferred.state).toMatchObject({ phase: "deferred", before, target });
    expect(transitionPlanRecovery(deferred.state, { type: "recover", current: before, finish: false }).state).toBe(deferred.state);
    const reviewed = transitionPlanRecovery(deferred.state, { type: "review" });
    expect(reviewed.state).toMatchObject({ phase: "pending", before, target });
    expect(transitionPlanRecovery(reviewed.state, { type: "recover", current: before, finish: false }).effect).toMatchObject({ type: "replace", target: before, completed: ready });
  });

  it("requests effects only for valid state transitions", () => {
    const a = { session: { draft: "A" }, local: {} };
    const b = { session: { draft: "B" }, local: {} };
    const empty = { session: { draft: null }, local: {} };
    const ready: OnboardingAlternative = { phase: "ready", owner: "a", requestId: "Soho £6", currentRequestId: "Soho £6", otherRequestId: null, other: a, archived: [] };
    const fresh = transitionPlanRecovery(ready, { type: "switch", current: b, empty, requestId: "Camden £5", fresh: true });
    expect(fresh.effect).toMatchObject({ type: "replace", target: empty, completed: { phase: "ready", requestId: "Camden £5", other: b, archived: [{ records: a }] } });
    const finished = transitionPlanRecovery(fresh.state, { type: "recover", current: b, finish: true });
    expect(finished.effect).toMatchObject({ type: "replace", target: empty });
    for (const event of [{ type: "defer" }, { type: "review" }, { type: "recover", current: b, finish: true }] as const) {
      const refused = transitionPlanRecovery(ready, event);
      expect(refused.state).toBe(ready);
      expect(refused.effect).toBeNull();
    }
    const missing = transitionPlanRecovery(ready, { type: "switch", current: b, empty, requestId: null, fresh: false, archiveIndex: 0 });
    expect(missing.state).toBe(ready);
    expect(missing.effect).toBeNull();
  });
  it("removes the former account's alternative on tab departure while another tab keeps its plan", () => {
    const local = storage();
    const formerTab = storage();
    const currentTab = storage();
    formerTab.setItem(PLAN_DRAFT_KEY, "account A private request");
    expect(switchOnboardingPlan(formerTab, local, "account-a")).toBe(true);
    currentTab.setItem(PLAN_DRAFT_KEY, "account B private request");
    expect(switchOnboardingPlan(currentTab, local, "account-b")).toBe(true);
    local.setItem(PLAN_INTAKE_STORAGE_KEY, "account B current shared plan");

    clearDeviceAccountSessionArtifacts(formerTab);

    expect(readOnboardingAlternative(formerTab, "account-a")).toBeNull();
    expect(readOnboardingAlternative(formerTab, "account-b")).toBeNull();
    expect(readOnboardingAlternative(currentTab, "account-b")?.other.session[PLAN_DRAFT_KEY]).toBe("account B private request");
    expect(local.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe("account B current shared plan");
    formerTab.setItem(PLAN_DRAFT_KEY, "account B new request");
    expect(switchOnboardingPlan(formerTab, local, "account-b")).toBe(true);
    expect(readOnboardingAlternative(formerTab, "account-b")?.other.session[PLAN_DRAFT_KEY]).toBe("account B new request");
  });

  it("clears a guest alternative when a new account takes ownership, while a same-account refresh preserves it", () => {
    const session = storage();
    const local = storage();
    session.setItem(PLAN_DRAFT_KEY, "guest private request");
    expect(switchOnboardingPlan(session, local, null)).toBe(true);
    expect(bindDeviceAccountOwner("account-b", local, session)).toBe(true);
    expect(readOnboardingAlternative(session, null)).toBeNull();
    expect(readOnboardingAlternative(session, "account-b")).toBeNull();
    session.setItem(PLAN_DRAFT_KEY, "account B request");
    expect(switchOnboardingPlan(session, local, "account-b")).toBe(true);
    expect(local.getItem(DEVICE_ACCOUNT_OWNER_KEY)).toBe("account-b");
    expect(bindDeviceAccountOwner("account-b", local, session)).toBe(false);
    expect(readOnboardingAlternative(session, "account-b")?.other.session[PLAN_DRAFT_KEY]).toBe("account B request");
  });
  it("retains both requests and scopes recovery to the account", () => {
    const session = storage();
    const local = storage();
    session.setItem(PLAN_DRAFT_KEY, "old pub and step-free");
    local.setItem(PLAN_INTAKE_STORAGE_KEY, "old budget");
    expect(switchOnboardingPlan(session, local, "account-a")).toBe(true);
    expect(readOnboardingAlternative(session, "account-b")).toBeNull();
    session.setItem(PLAN_DRAFT_KEY, "new Soho request");
    local.setItem(PLAN_INTAKE_STORAGE_KEY, "new budget");
    expect(switchOnboardingPlan(session, local, "account-a")).toBe(true);
    expect(session.getItem(PLAN_DRAFT_KEY)).toBe("old pub and step-free");
    expect(local.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe("old budget");
    expect(switchOnboardingPlan(session, local, "account-a")).toBe(true);
    expect(session.getItem(PLAN_DRAFT_KEY)).toBe("new Soho request");
    expect(local.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe("new budget");
  });

  it("retains both sides if a storage failure also prevents rollback", () => {
    const session = storage();
    const local = storage();
    session.setItem(PLAN_DRAFT_KEY, "old plan");
    local.setItem(PLAN_INTAKE_STORAGE_KEY, "old access need");
    expect(switchOnboardingPlan(session, local, null)).toBe(true);
    session.setItem(PLAN_DRAFT_KEY, "new plan");
    local.setItem(PLAN_INTAKE_STORAGE_KEY, "new budget");
    const blocked = { ...local, removeItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } as Storage;
    expect(switchOnboardingPlan(session, blocked, null)).toBe(false);
    expect(readOnboardingAlternative(session, null)?.phase).toBe("pending");
    expect(recoverOnboardingSwitch(session, local, null, false)).toBe(true);
    expect(session.getItem(PLAN_DRAFT_KEY)).toBe("new plan");
    expect(local.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe("new budget");
    expect(switchOnboardingPlan(session, local, null)).toBe(true);
    expect(session.getItem(PLAN_DRAFT_KEY)).toBe("old plan");
    expect(local.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe("old access need");
  });

  it("does not overwrite another tab's edit during a switch or recovery", () => {
    const session = storage();
    const local = storage();
    session.setItem(PLAN_DRAFT_KEY, "old plan");
    local.setItem(PLAN_INTAKE_STORAGE_KEY, "old access need");
    const racingSession = {
      ...session,
      removeItem: (key: string) => {
        session.removeItem(key);
        if (key === PLAN_DRAFT_KEY) local.setItem(PLAN_INTAKE_STORAGE_KEY, "other tab edit");
      },
    } as Storage;
    expect(switchOnboardingPlan(racingSession, local, null)).toBe(false);
    expect(local.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe("other tab edit");
    expect(readOnboardingAlternative(session, null)?.phase).toBe("pending");
    expect(recoverOnboardingSwitch(session, local, null, false)).toBe(false);
    expect(local.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe("other tab edit");
  });
});
