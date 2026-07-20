import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PLAN_INTAKE_STEPS,
  PLAN_INTAKE_STORAGE_KEY,
  buildPlanGenerationIntakeBody,
  createPlanIntakeDraft,
  parsePlanIntakeDraft,
  planIntakeHandoff,
  planIntakeNightContextPatch,
  planIntakeStepHasAnswer,
  readPlanIntakeDraft,
  reopenPlanIntakeStep,
  settlePlanIntakeStep,
  skipRemainingPlanIntake,
  startDateTimeForWindow,
  writePlanIntakeDraft,
  type PlanIntakeDraft,
} from "@/lib/planIntake";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

describe("progressive Plan intake", () => {
  it("starts with one area question and carries a remembered patch forward", () => {
    expect(createPlanIntakeDraft()).toMatchObject({
      currentStep: "area",
      settledSteps: [],
      completed: false,
      answers: { area: null },
    });

    expect(createPlanIntakeDraft({ kind: "patch", id: "brixton" })).toMatchObject({
      currentStep: "time-window",
      settledSteps: ["area"],
      answers: { area: "brixton" },
    });
  });

  it("migrates a matching legacy borough choice without inventing an admin-geography option", () => {
    expect(createPlanIntakeDraft({ kind: "borough", name: "Hackney" }).answers.area).toBe("hackney");
    expect(createPlanIntakeDraft({ kind: "borough", name: "City of Westminster" }).answers.area).toBeNull();
  });

  it("lets every step be skipped and records the distinction from an answer", () => {
    let draft = createPlanIntakeDraft();
    for (const step of PLAN_INTAKE_STEPS) {
      expect(draft.currentStep).toBe(step);
      draft = settlePlanIntakeStep(draft, { skip: true });
    }

    expect(draft.completed).toBe(true);
    expect(draft.settledSteps).toEqual(PLAN_INTAKE_STEPS);
    expect(draft.skippedSteps).toEqual(PLAN_INTAKE_STEPS);
    expect(planIntakeHandoff(draft)).toMatchObject({
      area: null,
      timeWindow: null,
      groupSize: null,
      budget: null,
      accessibilityNeeds: [],
      skipped: PLAN_INTAKE_STEPS,
    });
  });

  it("can bypass the remaining questions without discarding remembered answers", () => {
    const draft = createPlanIntakeDraft({ kind: "patch", id: "soho" });
    const completed = skipRemainingPlanIntake(draft);

    expect(completed.completed).toBe(true);
    expect(completed.answers.area).toBe("soho");
    expect(completed.skippedSteps).toEqual(PLAN_INTAKE_STEPS.slice(1));
  });

  it("keeps a current selection when the user switches to free description", () => {
    const selected = {
      ...createPlanIntakeDraft(),
      answers: { ...createPlanIntakeDraft().answers, area: "soho" as const },
    };
    const completed = skipRemainingPlanIntake(selected);

    expect(planIntakeStepHasAnswer(selected)).toBe(true);
    expect(completed.answers.area).toBe("soho");
    expect(completed.skippedSteps).not.toContain("area");
    expect(completed.skippedSteps).toEqual(PLAN_INTAKE_STEPS.slice(1));
  });

  it("reopens one completed answer and resumes at that exact step", () => {
    const completed = skipRemainingPlanIntake(createPlanIntakeDraft());
    const reopened = reopenPlanIntakeStep(completed, "budget");

    expect(reopened).toMatchObject({ currentStep: "budget", completed: false });
    expect(reopened.settledSteps).not.toContain("budget");
    expect(settlePlanIntakeStep(reopened, { skip: true }).completed).toBe(true);
  });
});

describe("Plan intake persistence", () => {
  it("round-trips a versioned, partially completed flow", () => {
    const storage = memoryStorage();
    const draft = settlePlanIntakeStep({
      ...createPlanIntakeDraft(),
      answers: { ...createPlanIntakeDraft().answers, area: "clapham" },
    });

    writePlanIntakeDraft(draft, storage);
    expect(storage.getItem(PLAN_INTAKE_STORAGE_KEY)).toContain('"version":1');
    expect(readPlanIntakeDraft(storage)).toEqual(draft);
  });

  it("rejects unknown versions and sanitises malformed optional answers", () => {
    expect(parsePlanIntakeDraft(JSON.stringify({ version: 2, currentStep: "area" }))).toBeNull();

    const parsed = parsePlanIntakeDraft(JSON.stringify({
      version: 1,
      currentStep: "group-size",
      settledSteps: ["area", "bogus", "area"],
      skippedSteps: ["bogus"],
      completed: true,
      answers: {
        area: "narnia",
        timeWindow: "whenever",
        groupSize: 400,
        budget: "free",
        budgetLimitPence: -1,
        accessibilityNeeds: ["step-free", "invented", "step-free"],
      },
    }));

    expect(parsed).toMatchObject({
      settledSteps: ["area"],
      skippedSteps: [],
      completed: false,
      answers: {
        area: null,
        timeWindow: null,
        groupSize: null,
        budget: null,
        budgetLimitPence: null,
        accessibilityNeeds: ["step-free"],
      },
    });
  });
});

describe("Wave 2.2 typed handoff", () => {
  it("preserves exact time, ceiling and accessibility constraints", () => {
    const draft: PlanIntakeDraft = {
      ...createPlanIntakeDraft(),
      answers: {
        area: "london-bridge" as const,
        timeWindow: "after-work" as const,
        groupSize: 5,
        budget: "value" as const,
        budgetLimitPence: 2500,
        accessibilityNeeds: ["step-free", "accessible-toilet"],
      },
    };

    expect(planIntakeHandoff(draft)).toEqual({
      version: 1,
      area: { kind: "night-patch", id: "london-bridge" },
      timeWindow: { id: "after-work", start: "17:30", end: "20:30" },
      groupSize: 5,
      budget: { tier: "value", limitPence: 2500 },
      accessibilityNeeds: ["step-free", "accessible-toilet"],
      skipped: [],
    });
    expect(planIntakeNightContextPatch(draft)).toEqual({
      nightArea: "bermondsey-london-bridge",
      daypart: "after_work",
      groupSize: 5,
      partyType: "friends",
      budget: "value",
      budgetLimitPence: 2500,
      accessibility: ["step-free", "accessible-toilet"],
    });
    expect(buildPlanGenerationIntakeBody(draft, "  quiet tables  ", null)).toMatchObject({
      query: "quiet tables",
      context: {
        nightArea: "bermondsey-london-bridge",
        daypart: "after_work",
        groupSize: 5,
        budgetLimitPence: 2500,
      },
      intake: {
        version: 1,
        area: { kind: "night-patch", id: "london-bridge" },
        accessibilityNeeds: ["step-free", "accessible-toilet"],
      },
    });
  });

  it("does not silently coerce Hackney into a different generation area", () => {
    const draft = createPlanIntakeDraft({ kind: "patch", id: "hackney" });
    expect(planIntakeHandoff(draft).area).toEqual({ kind: "night-patch", id: "hackney" });
    expect(planIntakeNightContextPatch(draft)).not.toHaveProperty("nightArea");
  });

  it("uses the selected window for the editable first-pint time", () => {
    expect(startDateTimeForWindow("2026-07-20T18:15", "late")).toBe("2026-07-20T22:00");
    expect(startDateTimeForWindow("", "evening")).toBe("");
  });
});

describe("intake accessibility and entry invariants", () => {
  it("is inline, keyboard-native and does not participate in routing or prompt budgets", () => {
    const root = path.resolve(__dirname, "..");
    const component = readFileSync(path.join(root, "components/plan/PlanIntake.tsx"), "utf8");
    const css = readFileSync(path.join(root, "app/plan/plan.css"), "utf8");

    expect(component).toContain('aria-current={step === draft.currentStep ? "step" : undefined}');
    expect(component).toContain('aria-pressed={draft.answers.area === patch.id}');
    expect(component).toContain("Skip for now");
    expect(component).not.toMatch(/useRouter|promptBudget|router\.(push|replace)/);
    expect(css).toMatch(/\.planIntake__continue[\s\S]*?min-height: 44px/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
