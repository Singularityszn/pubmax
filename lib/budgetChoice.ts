import { safeLocalStorage } from "@/lib/safeStorage";

/** What a pint should cost, as the reader would say it. */
export const BUDGET_CHOICES = [
  { id: "five", label: "£5 or less", ceiling: 5 },
  { id: "six", label: "£6 or less", ceiling: 6 },
  { id: "seven", label: "£7 or less", ceiling: 7 },
  { id: "any", label: "No limit", ceiling: null },
] as const;

export type BudgetChoiceId = (typeof BUDGET_CHOICES)[number]["id"];

export function isBudgetChoiceId(value: unknown): value is BudgetChoiceId {
  return BUDGET_CHOICES.some((choice) => choice.id === value);
}

/** The ceiling in pounds a choice stands for, null for "No limit". */
export function budgetCeiling(id: BudgetChoiceId): number | null {
  return BUDGET_CHOICES.find((choice) => choice.id === id)?.ceiling ?? null;
}

export const BUDGET_KEY = "pubmax:onboarding:budget:v1";

/** The remembered budget choice. Anything unrecognised reads as unanswered. */
export function readBudgetChoice(storage?: Storage | null): BudgetChoiceId | null {
  const store = storage ?? safeLocalStorage();
  if (!store) return null;
  try {
    const value = store.getItem(BUDGET_KEY);
    return isBudgetChoiceId(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeBudgetChoice(id: BudgetChoiceId, storage?: Storage | null): void {
  const store = storage ?? safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(BUDGET_KEY, id);
  } catch {
    // Storage full or blocked: the answer still counts for this visit.
  }
}
