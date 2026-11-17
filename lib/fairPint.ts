import { buildPriceEvidence, priceEvidenceUsableForCeiling } from "@/lib/planRouteEvidence";
import { budgetCeiling, readBudgetChoice } from "@/lib/onboardingFlow";
import { suppressMapFirstVisitPrompts } from "@/lib/mapFirstVisitArrivalGate";
import { safeLocalStorage } from "@/lib/safeStorage";

export type FairPintEvidence = readonly [unknown, unknown, unknown];
export type FairPintPin = { fairPint?: FairPintEvidence };
export const FAIR_PINT_KEY = "pubmax:fair-pint:v1";
export function validFairPint(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 300 && value <= 800 && value % 10 === 0;
}
export function fairPence(pin: FairPintPin, now: number): number | null {
  if (!pin.fairPint) return null;
  const [pence, url, observedAt] = pin.fairPint;
  const evidence = buildPriceEvidence({ pence, url, observedAt, label: "Pint Prices", now });
  return priceEvidenceUsableForCeiling(evidence) ? evidence.pence : null;
}
export function isFairPint(pin: FairPintPin, ceiling: number, now: number): boolean {
  const pence = fairPence(pin, now);
  return pence !== null && pence <= ceiling;
}
export function readFairPint(storage = safeLocalStorage()): number {
  try {
    const value: unknown = JSON.parse(storage?.getItem(FAIR_PINT_KEY) ?? "null");
    if (value && typeof value === "object" && "pence" in value && validFairPint(value.pence)) return value.pence;
  } catch {}
  const choice = readBudgetChoice(storage);
  return choice ? Math.round((budgetCeiling(choice) ?? 8) * 100) : 550;
}
export function writeFairPint(pence: number, storage = safeLocalStorage()): void {
  if (!validFairPint(pence)) return;
  try {
    storage?.setItem(FAIR_PINT_KEY, JSON.stringify({ pence }));
  } catch {}
}

export { compactFairPintPayload, expandFairPintPin } from "@/lib/slimListingPrices.mjs";

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
export function fairPintRequest(cityId: string, nightArea: string, pence: number, planStartIso?: string) {
  return {
    cityId,
    query: `maximum £${(pence / 100).toFixed(2)} per pint`,
    context: { nightArea, stopCount: 3 },
    ...(planStartIso ? { planStartIso } : {}),
  };
}
export type FairPintDrawn = { generated: FairPintGenerated; pence: number; start: string };
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
  | { type: "back" };
export function transitionFairPintPlan(state: FairPintPlanState, event: FairPintPlanEvent): FairPintPlanState {
  switch (event.type) {
    case "draw":
      return { ...state, phase: "drawing", request: event.request, error: "", retryAt: 0 };
    case "drawn":
      return state.request !== event.request ? state : { ...state, phase: "result", last: event.last, error: "" };
    case "failed":
      return state.request !== event.request
        ? state
        : { ...state, phase: state.last ? "result" : "dial", error: event.error, retryAt: event.retryAt };
    case "back":
      return { ...state, phase: "dial" };
    default: {
      const never: never = event;
      return never;
    }
  }
}

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
export function transitionFairPintSave(state: FairPintSaveState, event: FairPintSaveEvent): FairPintSaveState {
  if (event.type === "save") return { phase: "saving", scope: event.scope, notice: "" };
  if (event.scope !== state.scope) return state;
  switch (event.type) {
    case "saved":
      return {
        phase: "locked",
        scope: event.scope,
        planId: event.planId,
        notice: "",
        link: { phase: "loading" },
        share: null,
      };
    case "link":
      return state.phase !== "locked"
        ? state
        : {
            ...state,
            link: event.url ? { phase: "ready", url: event.url } : { phase: "failed" },
            notice: event.url ? "" : "Could not prepare the link. Try again.",
          };
    case "notice":
      return state.phase === "saving"
        ? { phase: "editing", scope: state.scope, notice: event.notice }
        : { ...state, notice: event.notice };
    case "share":
      return state.phase !== "locked" || event.outcome === "cancelled"
        ? state
        : {
            ...state,
            share: event.outcome,
            notice:
              event.outcome === "shared"
                ? "Shared."
                : event.outcome === "whatsapp"
                  ? "Opened WhatsApp."
                  : "Could not open sharing. Copy the link instead.",
          };
    default: {
      const never: never = event;
      return never;
    }
  }
}
