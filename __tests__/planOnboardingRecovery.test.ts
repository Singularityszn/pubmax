import { describe, expect, it } from "vitest";
import { readOnboardingAlternative, recoverOnboardingSwitch, switchOnboardingPlan } from "@/lib/planOnboardingRecovery";
import { PLAN_DRAFT_KEY, PLAN_INTAKE_STORAGE_KEY } from "@/lib/planDraftStorage";
import { bindDeviceAccountOwner, clearDeviceAccountSessionArtifacts, DEVICE_ACCOUNT_OWNER_KEY } from "@/lib/deviceAccountIdentity";

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
    expect(readOnboardingAlternative(session, null)?.pending).toBeDefined();
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
    expect(readOnboardingAlternative(session, null)?.pending).toBeDefined();
    expect(recoverOnboardingSwitch(session, local, null, false)).toBe(false);
    expect(local.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe("other tab edit");
  });
});
