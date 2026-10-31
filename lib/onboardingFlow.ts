// The first-run onboarding journey - the ONE place that names its steps, the
// questions it asks and what a reader's answer is worth.
//
// The reference is the captain's "Ideal Flow" deck (data/ in the Firstmate
// workspace, 24 Sep 2026). Four of its rules shape this file:
//   1. Each step answers one question, so a step is one entry in STEPS.
//   2. Every question says WHY it is asked, in the reader's terms, and what
//      stays private. The copy lives here, beside the answer it explains, so a
//      question can never ship without its reason.
//   3. A permission ask gets its own screen and a real reason before the system
//      prompt. The location screen is the first.
//   4. The result is built from the answers, never a feature tour.
//
// A question is only asked when the journey USES the answer. The budget below
// decides which listed pints the result calls "within your budget", and the
// location decides which pubs are near. A "usual order" question was left out
// because the listed price on a card is the cheapest pint, and nothing the
// reader chose would change it.
//
// Storage follows lib/firstRunTour.ts: SSR-safe and silent when storage is
// blocked. The budget is in localStorage. The chosen patch and the planner
// handoff are held in sessionStorage for this tab only. BUDGET_QUESTION owns
// the disclosure for storage and transmission through onboardingPlanHref.

import { WALKABLE_RADIUS_KM, walkMinutesFromKm, type NearMeCard } from "@/lib/nearMeAnswer";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";
import { tryGetNightArea, type NightAreaSlug } from "@/lib/nightAreas";
import { NIGHT_PATCHES } from "@/lib/nightPatches";
import { DEFAULT_PLAN_STOP_COUNT } from "@/lib/planStopCount";
import { appliedPintPriceCap } from "@/lib/pintPriceCaps";

/** The steps in the order a reader meets them. */
export const ONBOARDING_STEPS = [
  "london",
  "budget",
  "location",
  "result",
  "companion",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** The step after `step`, or null at the end of the journey. */
export function nextOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1] ?? null;
}

/** The step before `step`, or null at the start. */
export function previousOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) - 1] ?? null;
}

/** A one-based position for the progress bar. */
export function onboardingStepNumber(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step) + 1;
}

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

export const BUDGET_QUESTION = {
  title: "What's a fair pint to you?",
  why: "We use this to count the pubs near you that come in under it.",
  privacy: "Your budget is saved on this device. When you plan a night, it goes in the planner link and to our server.",
} as const;

/** The location ask's reason, spent on its own screen before the system prompt. */
export const LOCATION_PRIMER = {
  title: "Find the cheapest pint near you.",
  why: "Your location lets us rank pubs by how far you'd walk for the price.",
  privacy: "We use your location to rank nearby pubs and pick an area for your plan. Your coordinates are never stored or sent.",
} as const;

const BUDGET_KEY = "pubmax:onboarding:budget:v1";

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

const PATCH_KEY = "pubmax:onboarding:patch:v1";

export function writeOnboardingPatch(id: string | null, storage?: Storage | null): void {
  const store = storage ?? safeSessionStorage();
  if (!store) return;
  try {
    if (id) store.setItem(PATCH_KEY, id);
    else store.removeItem(PATCH_KEY);
  } catch {
    // Storage full or blocked: the patch still counts for this visit.
  }
}

/** The held patch id or `area:` identifier, never the browser's coordinates. */
export function readOnboardingPatch(storage?: Storage | null): string | null {
  const store = storage ?? safeSessionStorage();
  if (!store) return null;
  try {
    return store.getItem(PATCH_KEY);
  } catch {
    return null;
  }
}

const HANDOFF_KEY = "pubmax:onboarding:planner-handoff:v1";

export type PlannerHandoff = {
  nightArea?: NightAreaSlug;
  patch: { lat: number; lng: number } | null;
  budget: BudgetChoiceId | null;
};

/** Open the shared planner with the reader's choices, without a default map route. */
export function onboardingPlanHref(handoff: PlannerHandoff | null): string {
  const patch = handoff?.patch
    ? NIGHT_PATCHES.find(({ lat, lng }) => lat === handoff.patch?.lat && lng === handoff.patch?.lng)
    : null;
  const area = tryGetNightArea(handoff?.nightArea);
  const label = patch?.label ?? area?.name;
  const ceiling = handoff?.budget ? budgetCeiling(handoff.budget) : null;
  if (!label && ceiling === null) return "/plan?from=onboarding";
  const query = [
    `${DEFAULT_PLAN_STOP_COUNT} pubs${label ? ` in ${label}` : ""}`,
    ...(ceiling === null ? [] : [
      `under £${ceiling * DEFAULT_PLAN_STOP_COUNT} per person`,
      `maximum £${ceiling} per pint`,
    ]),
  ].join(", ");
  return `/plan?${new URLSearchParams({ query, from: "onboarding" })}`;
}

/** A handoff the planner never opened for is stale after this long. */
const HANDOFF_MAX_AGE_MS = 10 * 60_000;

/** Optional tab restoration. The journey opens the planner from its current choice. */
export function writePlannerHandoff(
  handoff: PlannerHandoff,
  storage?: Storage | null,
  now = Date.now(),
): void {
  const store = storage ?? safeSessionStorage();
  if (!store) return;
  try {
    store.setItem(HANDOFF_KEY, JSON.stringify({ ...handoff, at: now }));
  } catch {
    // Storage full or blocked: the journey still hands over its current choice.
  }
}

/** The handoff, or null when none is held or it does not parse. Does not clear it. */
export function readPlannerHandoff(storage?: Storage | null, now = Date.now()): PlannerHandoff | null {
  const store = storage ?? safeSessionStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { patch?: { lat?: unknown; lng?: unknown } | null; budget?: unknown; nightArea?: unknown; at?: unknown };
    if (typeof value.at !== "number" || now - value.at > HANDOFF_MAX_AGE_MS) return null;
    const lat = value.patch?.lat;
    const lng = value.patch?.lng;
    const area = typeof value.nightArea === "string" ? tryGetNightArea(value.nightArea) : null;
    return {
      ...(area ? { nightArea: area.slug } : {}),
      patch:
        typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
          ? { lat, lng }
          : null,
      budget: isBudgetChoiceId(value.budget) ? value.budget : null,
    };
  } catch {
    return null;
  }
}

/**
 * What the desktop map takes from a handoff. It has no area picker or Max each
 * field, so the budget becomes the pint price cap and the patch becomes the
 * camera. Either is null when the journey did not give it.
 */
export function desktopHandoffMoves(handoff: PlannerHandoff): {
  maxPrice: number | null;
  center: [number, number] | null;
} {
  const ceiling = handoff.budget ? budgetCeiling(handoff.budget) : null;
  return {
    // The map applies the shared cap its controls print (lib/pintPriceCaps.ts),
    // so a £5 budget applies the £5 cap, never a figure no control shows.
    maxPrice: ceiling === null ? null : appliedPintPriceCap(ceiling),
    center: handoff.patch ? [handoff.patch.lng, handoff.patch.lat] : null,
  };
}

export function clearPlannerHandoff(storage?: Storage | null): void {
  const store = storage ?? safeSessionStorage();
  if (!store) return;
  try {
    store.removeItem(HANDOFF_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

/** Where the reader's answer is measured from. */
export type OnboardingOrigin =
  | { kind: "location"; lat: number; lng: number }
  | { kind: "patch"; id: string; label: string; lat: number; lng: number };

export type OnboardingResult = {
  /** The cheapest listed pint in the answer, or null when nothing is priced. */
  best: NearMeCard | null;
  /** The next cheapest after `best`, at most two. */
  others: NearMeCard[];
  /** How many priced pubs in the walk come in at or under the budget. Null when no limit. */
  withinBudget: number | null;
  /** The walk, in minutes, that count is taken over. */
  walkMinutes: number;
  /** Whether every card is inside the walk, or the answer widened. */
  widened: boolean;
};

/**
 * The result screen's content, worked out from the ranked cards. Pure so the
 * screen and its test read the same numbers. `cards` arrive cheapest first, as
 * `rankNearMe` returns them. `walkPrices` is every listed price inside the
 * walk (`pricedWithinWalk`), because the count the question promised is over
 * the pubs near the reader, not over the few cards the screen has room for.
 */
export function onboardingResult(
  cards: readonly NearMeCard[],
  budget: BudgetChoiceId | null,
  widened: boolean,
  walkPrices: readonly number[],
): OnboardingResult {
  const ceiling = budget ? budgetCeiling(budget) : null;
  return {
    best: cards[0] ?? null,
    others: cards.slice(1, 3),
    withinBudget:
      ceiling === null ? null : walkPrices.filter((price) => price <= ceiling).length,
    walkMinutes: walkMinutesFromKm(WALKABLE_RADIUS_KM),
    widened,
  };
}
