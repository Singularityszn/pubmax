import { budgetCeiling, readBudgetChoice } from "@/lib/budgetChoice";
import { suppressMapFirstVisitPrompts } from "@/lib/mapFirstVisitArrivalGate";
import { safeLocalStorage } from "@/lib/safeStorage";
import { CRAWL_ARRIVAL_PARAMS, PLAN_HANDOFF_PARAMS, searchHasArrivalParam, TRUSTED_HANDOFF_ARRIVAL_PARAMS } from "@/lib/mapArrivalParams";

export const supportsFairPint = (cityId: string) => cityId === "london";
export const FAIR_PINT_PATH_PATTERN = "^/map(?:/london)?/?$";
export const FAIR_PINT_INTENT_PARAMS = [
  ...CRAWL_ARRIVAL_PARAMS.filter((key) => key !== "max"),
  ...TRUSTED_HANDOFF_ARRIVAL_PARAMS, ...PLAN_HANDOFF_PARAMS, "place", "uk",
];
export const fairPintSearchSuppresses = (search: string) => searchHasArrivalParam(search, FAIR_PINT_INTENT_PARAMS);

type FairPintEvidence = readonly [unknown, unknown, unknown];
export type FairPintPin = { fairPint?: FairPintEvidence };
export const FAIR_PINT_KEY = "pubmax:fair-pint:v1";
export function validFairPint(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 300 && value <= 800 && value % 10 === 0;
}
export function readFairPint(storage = safeLocalStorage()): number {
  try {
    const value: unknown = JSON.parse(storage?.getItem(FAIR_PINT_KEY) ?? "null");
    if (value && typeof value === "object" && "pence" in value && validFairPint(value.pence)) return value.pence;
  } catch {}
  const choice = readBudgetChoice(storage);
  const fallback = choice ? Math.round((budgetCeiling(choice) ?? 8) * 100) : 550;
  return validFairPint(fallback) ? fallback : 550;
}
export function writeFairPint(pence: number, storage = safeLocalStorage()): void {
  if (!validFairPint(pence)) return;
  try {
    storage?.setItem(FAIR_PINT_KEY, JSON.stringify({ pence }));
  } catch {}
}

export { compactFairPintPayload } from "@/lib/slimListingPrices.mjs";

let session = { active: false, pence: 550 };
const activeListeners = new Set<() => void>();
const paintListeners = new Set<() => void>();
export const fairPintActive = () => session.active;
export const fairPintSession = () => session;
export function subscribeFairPintActive(listener: () => void) {
  activeListeners.add(listener);
  return () => {
    activeListeners.delete(listener);
  };
}
export function subscribeFairPintPaint(listener: () => void) {
  paintListeners.add(listener);
  return () => {
    paintListeners.delete(listener);
  };
}
export function setFairPintSession(active: boolean, pence = session.pence) {
  const changed = active !== session.active;
  if (active) suppressMapFirstVisitPrompts();
  session = { active, pence };
  if (changed) activeListeners.forEach((listener) => listener());
  paintListeners.forEach((listener) => listener());
}

export type FairPintGenerated = {
  stops: {
    venueId: string;
    venueName: string;
    estimatedPintPricePence?: number | null;
    priceCategory?: string;
    priceServing?: string;
    priceEvidence?: import("@/lib/planRouteEvidence").PlanPriceEvidence | null;
    walkingMinutesFromPrevious?: number | null;
  }[];
  inferredContext: import("@/lib/nightPlanning").NightContext;
  planningConfidence: import("@/lib/planIntelligence").PlanningConfidence;
  routeTotals?: import("@/lib/planIntelligence").PlanRouteTotals;
  groundingProof: string;
  operationKey: string;
};
export type FairPintDrawn = { generated: FairPintGenerated; pence: number; start: string; startIso: string };
export type FairPintPlanState = {
  phase: "dial" | "drawing" | "result";
  request: number;
  last: FairPintDrawn | null;
  error: string;
  retryAt: number;
};
export type FairPintPlanEvent =
  | { type: "draw"; request: number }
  | { type: "drawn"; request: number; last: FairPintDrawn }
  | { type: "failed"; request: number; error: string; retryAt: number }
  | { type: "restore" }
  | { type: "back" };

export type FairPintSaveState =
  | { phase: "editing"; scope: string; notice: string }
  | { phase: "saving"; scope: string; notice: string }
  | {
      phase: "locked";
      scope: string;
      notice: string;
      planId: string;
      link: { phase: "loading" } | { phase: "failed" } | { phase: "ready"; url: string };
      share: import("@/lib/shareSheet").ShareOutcome | null;
    };
export type FairPintSaveEvent =
  | { type: "save"; scope: string }
  | { type: "saved"; scope: string; planId: string }
  | { type: "link"; scope: string; url: string | null }
  | { type: "notice"; scope: string; notice: string }
  | { type: "share"; scope: string; outcome: import("@/lib/shareSheet").ShareOutcome };

export type EarlyFairPint = {
  pence: number;
  releases: number;
  committedPence?: number;
  handledReleases?: number;
  dragging?: boolean;
  closed?: boolean;
  location?: Promise<GeolocationPosition | null>;
};
declare global {
  interface Window {
    __pubmaxEarlyFairPint?: EarlyFairPint;
  }
}
export function takeEarlyFairPint(): EarlyFairPint | null {
  if (typeof window === "undefined") return null;
  const value = window.__pubmaxEarlyFairPint ?? null;
  if (value?.dragging) return null;
  delete window.__pubmaxEarlyFairPint;
  return value;
}
export function clearEarlyFairPint(): void {
  if (typeof window !== "undefined") delete window.__pubmaxEarlyFairPint;
}
export function earlyFairPintDragging(): boolean {
  return typeof window !== "undefined" && window.__pubmaxEarlyFairPint?.dragging === true;
}
export function earlyFairPintClosed(): boolean {
  return typeof window !== "undefined" && window.__pubmaxEarlyFairPint?.closed === true;
}

export function bootFairPintCard(
  config: {
    priceKey: string;
    budgetKey: string;
    dismissalKey: string;
    changeEvent: string;
    budgets: Record<string, number>;
    pathPattern: string;
    intentKeys: readonly string[];
  },
  valid: (value: unknown) => value is number,
  suppresses: (search: string, keys: readonly string[]) => boolean,
) {
  const card = document.querySelector<HTMLElement>("[data-fair-prelude]");
  if (!card || !new RegExp(config.pathPattern).test(location.pathname) || suppresses(location.search, config.intentKeys)) return;
  try {
    const store = localStorage;
    if (store.getItem(config.dismissalKey) !== null) return;
    let stored: unknown;
    try {
      stored = JSON.parse(store.getItem(config.priceKey) ?? "null");
    } catch {}
    const saved = stored && typeof stored === "object" && "pence" in stored ? stored.pence : null;
    const fallback = config.budgets[store.getItem(config.budgetKey) ?? ""];
    const early: EarlyFairPint = { pence: valid(saved) ? saved : valid(fallback) ? fallback : 550, releases: 0 };
    early.committedPence = early.pence;
    window.__pubmaxEarlyFairPint = early;
    const range = card.querySelector<HTMLInputElement>("input[type=range]");
    const output = card.querySelector("output");
    if (!range || !output) return;
    let committed = early.pence,
      dirty = false;
    const notify = () => window.dispatchEvent(new Event(config.changeEvent));
    const paint = () => {
      range.value = String(early.pence);
      const amount = `£${(early.pence / 100).toFixed(2)}`;
      output.textContent = amount;
      range.setAttribute("aria-valuetext", `${amount}, loading prices`);
    };
    const release = () => {
      early.dragging = false;
      if (dirty) {
        dirty = false;
        committed = early.pence;
        early.committedPence = committed;
        early.releases++;
        try {
          store.setItem(config.priceKey, JSON.stringify({ pence: early.pence }));
        } catch {}
      }
      notify();
    };
    range.addEventListener("pointerdown", () => {
      early.dragging = true;
      notify();
    });
    range.addEventListener("input", () => {
      early.pence = range.valueAsNumber;
      early.dragging = true;
      dirty = true;
      paint();
      notify();
    });
    range.addEventListener("pointerup", release);
    range.addEventListener("change", release);
    range.addEventListener("keyup", release);
    range.addEventListener("keydown", (event) => {
      if (event.key !== "PageUp" && event.key !== "PageDown") return;
      event.preventDefault();
      early.pence = Math.min(800, Math.max(300, early.pence + (event.key === "PageUp" ? 50 : -50)));
      early.dragging = true;
      dirty = true;
      paint();
      notify();
    });
    const cancel = () => {
      dirty = false;
      early.dragging = false;
      early.pence = committed;
      paint();
      notify();
    };
    range.addEventListener("pointercancel", cancel);
    range.addEventListener("blur", cancel);
    card.querySelector('[aria-label="Close"]')?.addEventListener("click", () => {
      early.closed = true;
      card.hidden = true;
      notify();
      try {
        store.setItem(config.dismissalKey, "dismissed");
      } catch {}
    });
    card.querySelector("[data-early-location]")?.addEventListener("click", () => {
      early.location = new Promise((resolve) => {
        if (!navigator.geolocation) {
          resolve(null);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (fix) => resolve(fix),
          () => resolve(null),
        );
      });
    });
    paint();
    card.hidden = false;
  } catch {}
}

export { isFairPint } from "@/lib/fairPintPricing";
export { fairPintRequest, transitionFairPintPlan } from "@/lib/fairPintTransitions";
