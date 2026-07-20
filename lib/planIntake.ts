import {
  NIGHT_PATCHES,
  resolveNightPatch,
  type NightPatchId,
  type RememberedArea,
} from "@/lib/nightPatches";
import type {
  Budget,
  Daypart,
  NightContext,
  NightAreaSlug,
  PartyType,
} from "@/lib/nightPlanning";

export const PLAN_INTAKE_VERSION = 1 as const;
export const PLAN_INTAKE_STORAGE_KEY = "pubmax:plan-intake:v1";

export const PLAN_INTAKE_STEPS = [
  "area",
  "time-window",
  "group-size",
  "budget",
  "accessibility",
] as const;
export type PlanIntakeStep = (typeof PLAN_INTAKE_STEPS)[number];

export const PLAN_TIME_WINDOWS = [
  { id: "after-work", label: "After work", note: "5:30 to 8:30", start: "17:30", end: "20:30", daypart: "after_work" },
  { id: "evening", label: "Evening", note: "7:00 to 11:00", start: "19:00", end: "23:00", daypart: "evening" },
  { id: "late", label: "Late", note: "10:00 onwards", start: "22:00", end: null, daypart: "late_night" },
] as const satisfies readonly {
  id: string;
  label: string;
  note: string;
  start: string;
  end: string | null;
  daypart: Daypart;
}[];
export type PlanTimeWindowId = (typeof PLAN_TIME_WINDOWS)[number]["id"];

export const PLAN_BUDGET_OPTIONS = [
  { id: "value", label: "Keep it lean", note: "Value-led stops", budget: "value" },
  { id: "standard", label: "Standard", note: "A balanced night", budget: "standard" },
  { id: "treat", label: "Treat night", note: "Room to spend more", budget: "treat" },
] as const satisfies readonly {
  id: string;
  label: string;
  note: string;
  budget: Budget;
}[];

export const PLAN_ACCESSIBILITY_NEEDS = [
  { id: "step-free", label: "Step-free access" },
  { id: "accessible-toilet", label: "Accessible toilet" },
  { id: "seating", label: "Reliable seating" },
  { id: "low-noise", label: "Quieter spaces" },
] as const;
export type PlanAccessibilityNeed = (typeof PLAN_ACCESSIBILITY_NEEDS)[number]["id"];

export type PlanIntakeAnswers = {
  area: NightPatchId | null;
  timeWindow: PlanTimeWindowId | null;
  groupSize: number | null;
  budget: Budget | null;
  budgetLimitPence: number | null;
  accessibilityNeeds: PlanAccessibilityNeed[];
};

export type PlanIntakeDraft = {
  version: typeof PLAN_INTAKE_VERSION;
  currentStep: PlanIntakeStep;
  settledSteps: PlanIntakeStep[];
  skippedSteps: PlanIntakeStep[];
  completed: boolean;
  answers: PlanIntakeAnswers;
};

/** Stable client-to-generator envelope owned by Wave 2.1 and consumed by 2.2. */
export type PlanIntakeHandoff = {
  version: typeof PLAN_INTAKE_VERSION;
  area: { kind: "night-patch"; id: NightPatchId } | null;
  timeWindow: { id: PlanTimeWindowId; start: string; end: string | null } | null;
  groupSize: number | null;
  budget: { tier: Budget; limitPence: number | null } | null;
  accessibilityNeeds: PlanAccessibilityNeed[];
  skipped: PlanIntakeStep[];
};

const PATCH_TO_NIGHT_AREA: Partial<Record<NightPatchId, NightAreaSlug>> = {
  soho: "piccadilly-soho",
  shoreditch: "shoreditch",
  camden: "camden",
  "london-bridge": "bermondsey-london-bridge",
  brixton: "brixton",
  clapham: "clapham",
  islington: "islington",
};

function isStep(value: unknown): value is PlanIntakeStep {
  return typeof value === "string" && (PLAN_INTAKE_STEPS as readonly string[]).includes(value);
}

function isPatchId(value: unknown): value is NightPatchId {
  return typeof value === "string" && NIGHT_PATCHES.some((patch) => patch.id === value);
}

function isTimeWindow(value: unknown): value is PlanTimeWindowId {
  return typeof value === "string" && PLAN_TIME_WINDOWS.some((option) => option.id === value);
}

function isBudget(value: unknown): value is Budget {
  return PLAN_BUDGET_OPTIONS.some((option) => option.budget === value);
}

function isAccessibilityNeed(value: unknown): value is PlanAccessibilityNeed {
  return typeof value === "string" && PLAN_ACCESSIBILITY_NEEDS.some((option) => option.id === value);
}

function uniqueSteps(value: unknown): PlanIntakeStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isStep).filter((step, index, all) => all.indexOf(step) === index);
}

function cleanAnswers(value: unknown): PlanIntakeAnswers {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const groupSize = typeof row.groupSize === "number" && Number.isInteger(row.groupSize)
    && row.groupSize >= 1 && row.groupSize <= 30 ? row.groupSize : null;
  const budget = isBudget(row.budget) ? row.budget : null;
  const budgetLimitPence = budget && typeof row.budgetLimitPence === "number"
    && Number.isInteger(row.budgetLimitPence)
    && row.budgetLimitPence >= 500
    && row.budgetLimitPence <= 50_000 ? row.budgetLimitPence : null;
  const accessibilityNeeds = Array.isArray(row.accessibilityNeeds)
    ? row.accessibilityNeeds.filter(isAccessibilityNeed)
      .filter((need, index, all) => all.indexOf(need) === index)
    : [];
  return {
    area: isPatchId(row.area) ? row.area : null,
    timeWindow: isTimeWindow(row.timeWindow) ? row.timeWindow : null,
    groupSize,
    budget,
    budgetLimitPence,
    accessibilityNeeds,
  };
}

export function planIntakeStepHasAnswer(
  draft: PlanIntakeDraft,
  step: PlanIntakeStep = draft.currentStep,
): boolean {
  switch (step) {
    case "area": return draft.answers.area !== null;
    case "time-window": return draft.answers.timeWindow !== null;
    case "group-size": return draft.answers.groupSize !== null;
    case "budget": return draft.answers.budget !== null;
    case "accessibility": return draft.answers.accessibilityNeeds.length > 0;
  }
}

function rememberedPatchId(remembered: RememberedArea | null): NightPatchId | null {
  if (!remembered) return null;
  if (remembered.kind === "patch") return isPatchId(remembered.id) ? remembered.id : null;
  const normalized = remembered.name.trim().toLocaleLowerCase();
  return NIGHT_PATCHES.find((patch) => patch.label.toLocaleLowerCase() === normalized)?.id ?? null;
}

export function createPlanIntakeDraft(remembered: RememberedArea | null = null): PlanIntakeDraft {
  const area = rememberedPatchId(remembered);
  return {
    version: PLAN_INTAKE_VERSION,
    currentStep: area ? "time-window" : "area",
    settledSteps: area ? ["area"] : [],
    skippedSteps: [],
    completed: false,
    answers: {
      area,
      timeWindow: null,
      groupSize: null,
      budget: null,
      budgetLimitPence: null,
      accessibilityNeeds: [],
    },
  };
}

export function parsePlanIntakeDraft(raw: string | null): PlanIntakeDraft | null {
  if (!raw || raw.length > 12_000) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || value.version !== PLAN_INTAKE_VERSION || !isStep(value.currentStep)) return null;
    const settledSteps = uniqueSteps(value.settledSteps);
    const skippedSteps = uniqueSteps(value.skippedSteps).filter((step) => settledSteps.includes(step));
    const completed = value.completed === true
      && PLAN_INTAKE_STEPS.every((step) => settledSteps.includes(step));
    return {
      version: PLAN_INTAKE_VERSION,
      currentStep: value.currentStep,
      settledSteps,
      skippedSteps,
      completed,
      answers: cleanAnswers(value.answers),
    };
  } catch {
    return null;
  }
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readPlanIntakeDraft(storage?: Storage | null): PlanIntakeDraft | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    return parsePlanIntakeDraft(store.getItem(PLAN_INTAKE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writePlanIntakeDraft(draft: PlanIntakeDraft, storage?: Storage | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    const next = JSON.stringify(draft);
    if (store.getItem(PLAN_INTAKE_STORAGE_KEY) !== next) {
      store.setItem(PLAN_INTAKE_STORAGE_KEY, next);
    }
  } catch {
    // Planning remains available in memory when storage is blocked or full.
  }
}

function clearAnswerForStep(answers: PlanIntakeAnswers, step: PlanIntakeStep): PlanIntakeAnswers {
  switch (step) {
    case "area": return { ...answers, area: null };
    case "time-window": return { ...answers, timeWindow: null };
    case "group-size": return { ...answers, groupSize: null };
    case "budget": return { ...answers, budget: null, budgetLimitPence: null };
    case "accessibility": return { ...answers, accessibilityNeeds: [] };
  }
}

export function settlePlanIntakeStep(
  draft: PlanIntakeDraft,
  options: { skip?: boolean } = {},
): PlanIntakeDraft {
  const step = draft.currentStep;
  const settledSteps = [...new Set([...draft.settledSteps, step])];
  const skippedSteps = options.skip
    ? [...new Set([...draft.skippedSteps, step])]
    : draft.skippedSteps.filter((candidate) => candidate !== step);
  const answers = options.skip ? clearAnswerForStep(draft.answers, step) : draft.answers;
  const nextStep = PLAN_INTAKE_STEPS.find((candidate) => !settledSteps.includes(candidate));
  return {
    ...draft,
    answers,
    settledSteps,
    skippedSteps,
    currentStep: nextStep ?? step,
    completed: nextStep === undefined,
  };
}

export function reopenPlanIntakeStep(draft: PlanIntakeDraft, step: PlanIntakeStep): PlanIntakeDraft {
  return {
    ...draft,
    currentStep: step,
    settledSteps: draft.settledSteps.filter((candidate) => candidate !== step),
    skippedSteps: draft.skippedSteps.filter((candidate) => candidate !== step),
    completed: false,
  };
}

export function skipRemainingPlanIntake(draft: PlanIntakeDraft): PlanIntakeDraft {
  const unsettled = PLAN_INTAKE_STEPS.filter((step) => !draft.settledSteps.includes(step));
  const unanswered = unsettled.filter((step) => !planIntakeStepHasAnswer(draft, step));
  return {
    ...draft,
    answers: unanswered.reduce(clearAnswerForStep, draft.answers),
    settledSteps: [...PLAN_INTAKE_STEPS],
    skippedSteps: [
      ...new Set([
        ...draft.skippedSteps.filter((step) => !unsettled.includes(step)),
        ...unanswered,
      ]),
    ],
    completed: true,
  };
}

export function planIntakeHandoff(draft: PlanIntakeDraft): PlanIntakeHandoff {
  const timeWindow = PLAN_TIME_WINDOWS.find((option) => option.id === draft.answers.timeWindow);
  return {
    version: PLAN_INTAKE_VERSION,
    area: draft.answers.area ? { kind: "night-patch", id: draft.answers.area } : null,
    timeWindow: timeWindow
      ? { id: timeWindow.id, start: timeWindow.start, end: timeWindow.end }
      : null,
    groupSize: draft.answers.groupSize,
    budget: draft.answers.budget
      ? { tier: draft.answers.budget, limitPence: draft.answers.budgetLimitPence }
      : null,
    accessibilityNeeds: [...draft.answers.accessibilityNeeds],
    skipped: [...draft.skippedSteps],
  };
}

/** Compatibility adapter for the current generator. Wave 2.2 consumes the full handoff. */
export function planIntakeNightContextPatch(draft: PlanIntakeDraft): Partial<NightContext> {
  const timeWindow = PLAN_TIME_WINDOWS.find((option) => option.id === draft.answers.timeWindow);
  const nightArea = draft.answers.area ? PATCH_TO_NIGHT_AREA[draft.answers.area] : undefined;
  const partyType: PartyType | undefined = draft.answers.groupSize === null
    ? undefined
    : draft.answers.groupSize === 1 ? "solo" : "friends";
  return {
    ...(nightArea ? { nightArea } : {}),
    ...(timeWindow ? { daypart: timeWindow.daypart } : {}),
    ...(draft.answers.groupSize !== null ? { groupSize: draft.answers.groupSize } : {}),
    ...(partyType ? { partyType } : {}),
    ...(draft.answers.budget ? { budget: draft.answers.budget } : {}),
    ...(draft.answers.budgetLimitPence !== null
      ? { budgetLimitPence: draft.answers.budgetLimitPence }
      : {}),
    ...(draft.answers.accessibilityNeeds.length > 0
      ? { accessibility: [...draft.answers.accessibilityNeeds] }
      : {}),
  };
}

export type PlanGenerationIntakeBody = {
  query?: string;
  context?: Partial<NightContext>;
  intake: PlanIntakeHandoff;
};

/**
 * One request seam for the Plan composer. The compatibility context keeps the
 * current generator useful; Wave 2.2 reads `intake` as the exact constraint
 * source and owns enforcement.
 */
export function buildPlanGenerationIntakeBody(
  draft: PlanIntakeDraft,
  query: string,
  currentContext: NightContext | null,
): PlanGenerationIntakeBody {
  const cleanQuery = query.trim();
  const context = { ...(currentContext ?? {}), ...planIntakeNightContextPatch(draft) };
  return {
    ...(cleanQuery ? { query: cleanQuery } : {}),
    ...(Object.keys(context).length > 0 ? { context } : {}),
    intake: planIntakeHandoff(draft),
  };
}

export function planIntakeSummary(draft: PlanIntakeDraft): string[] {
  const patch = resolveNightPatch(draft.answers.area);
  const time = PLAN_TIME_WINDOWS.find((option) => option.id === draft.answers.timeWindow);
  const budget = PLAN_BUDGET_OPTIONS.find((option) => option.budget === draft.answers.budget);
  const accessibilityCount = draft.answers.accessibilityNeeds.length;
  return [
    ...(patch ? [patch.label] : []),
    ...(time ? [time.label] : []),
    ...(draft.answers.groupSize ? [`${draft.answers.groupSize} ${draft.answers.groupSize === 1 ? "person" : "people"}`] : []),
    ...(budget ? [draft.answers.budgetLimitPence
      ? `Up to £${Math.round(draft.answers.budgetLimitPence / 100)} each`
      : budget.label] : []),
    ...(accessibilityCount ? [`${accessibilityCount} access ${accessibilityCount === 1 ? "need" : "needs"}`] : []),
  ];
}

export function startDateTimeForWindow(current: string, windowId: PlanTimeWindowId): string {
  const option = PLAN_TIME_WINDOWS.find((candidate) => candidate.id === windowId);
  if (!option) return current;
  const date = /^\d{4}-\d{2}-\d{2}/.exec(current)?.[0];
  return date ? `${date}T${option.start}` : current;
}
