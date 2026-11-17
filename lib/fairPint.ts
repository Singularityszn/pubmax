import { buildPriceEvidence, priceEvidenceUsableForCeiling } from "@/lib/planRouteEvidence";
import { budgetCeiling, readBudgetChoice } from "@/lib/onboardingFlow";
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
  try { storage?.setItem(FAIR_PINT_KEY, JSON.stringify({ pence })); } catch {}
}

const PINT_URL_PREFIX = "https://www.pint-prices.com/pub/";
/** Repeated evidence is cell metadata. Each venue retains one exact observation. */
export function compactFairPintPayload<T extends FairPintPin & { name?: string; priceSource?: string; priceObservedAt?: string }>(pins: readonly T[]) {
  const dates = [...new Set(pins.flatMap((pin) => typeof pin.fairPint?.[2] === "string" ? [pin.fairPint[2]] : []))];
  const prefix = pins.filter((pin) => typeof pin.fairPint?.[1] === "string" && pin.fairPint[1].startsWith(PINT_URL_PREFIX)).length >= 2 ? PINT_URL_PREFIX : null;
  const rows = pins.map((pin) => {
    if (!pin.fairPint) return pin;
    const [pence, url, date] = pin.fairPint;
    if (typeof url !== "string" || typeof date !== "string") return pin;
    const row = { ...pin };
    let flags = 0;
    if (row.priceSource === "Pint Prices") { delete row.priceSource; flags |= 1; }
    if (row.priceObservedAt === date.slice(0, 10)) { delete row.priceObservedAt; flags |= 2; }
    delete row.fairPint;
    let encoded = url;
    const suffix = typeof row.name === "string" ? "/" + encodeURIComponent(row.name) : "";
    if (suffix && encoded.endsWith(suffix)) { encoded = encoded.slice(0, -suffix.length); flags |= 4; }
    if (prefix && encoded.startsWith(prefix)) encoded = "~" + encoded.slice(prefix.length).replaceAll("%20", " ");
    return { ...row, fp: [pence, encoded, dates.indexOf(date), ...(flags === 3 ? [] : [flags])] };
  });
  return { rows, ft: dates.map((date) => Date.parse(date)), ...(prefix ? { fu: prefix } : {}) };
}
export function expandFairPintPin(value: unknown, metadata?: { ft?: unknown; fu?: unknown }): unknown {
  if (!value || typeof value !== "object" || !("fp" in value) || !Array.isArray(value.fp)) return value;
  const { fp, ...row } = value;
  const [pence, encoded, index, flags = 3] = fp;
  const time = Array.isArray(metadata?.ft) && Number.isInteger(index) ? metadata.ft[index] : null;
  if (fp.length < 3 || fp.length > 4 || typeof encoded !== "string" || typeof time !== "number" || !Number.isFinite(time)
    || !Number.isInteger(flags) || flags < 0 || flags > 7) return row;
  const stamp = new Date(time);
  if (!Number.isFinite(stamp.getTime())) return row;
  const date = stamp.toISOString();
  let url = encoded;
  if (url.startsWith("~")) {
    if (typeof metadata?.fu !== "string") return row;
    url = metadata.fu + url.slice(1).replaceAll(" ", "%20");
  }
  if (flags & 4) {
    if (!("name" in row) || typeof row.name !== "string") return row;
    url += "/" + encodeURIComponent(row.name);
  }
  return { ...row, fairPint: [pence, url, date], ...(flags & 1 ? { priceSource: "Pint Prices" } : {}), ...(flags & 2 ? { priceObservedAt: date.slice(0, 10) } : {}) };
}

let session = { active: false, pence: 550 };
let promptsSuppressed = false;
export const fairPintPromptsSuppressed = () => promptsSuppressed;
const activeListeners = new Set<() => void>();
const paintListeners = new Set<() => void>();
export const fairPintActive = () => session.active;
export const fairPintSession = () => session;
export function subscribeFairPintActive(listener: () => void) { activeListeners.add(listener); return () => { activeListeners.delete(listener); }; }
export function subscribeFairPintPaint(listener: () => void) { paintListeners.add(listener); return () => { paintListeners.delete(listener); }; }
export function setFairPintSession(active: boolean, pence = session.pence) {
  const changed = active !== session.active;
  if (active) promptsSuppressed = true;
  session = { active, pence };
  if (changed) activeListeners.forEach((listener) => listener());
  paintListeners.forEach((listener) => listener());
}

export type FairPintGenerated = {
  stops: { venueId: string; venueName: string; estimatedPintPricePence?: number | null; priceCategory?: string; priceServing?: string; priceEvidence?: import("@/lib/planRouteEvidence").PlanPriceEvidence | null; walkingMinutesFromPrevious?: number | null }[];
  inferredContext: import("@/lib/nightPlanning").NightContext;
  planningConfidence: import("@/lib/planIntelligence").PlanningConfidence;
  routeTotals?: import("@/lib/planIntelligence").PlanRouteTotals;
  groundingProof: string; operationKey: string;
};
export function fairPintRequest(cityId: string, nightArea: string, pence: number, planStartIso?: string) {
  return { cityId, query: `maximum £${(pence / 100).toFixed(2)} per pint`, context: { nightArea, stopCount: 3 }, ...(planStartIso ? { planStartIso } : {}) };
}
export type FairPintDrawn = { generated: FairPintGenerated; pence: number; start: string };
export type FairPintPlanState = { phase: "dial" | "drawing" | "result"; request: number; last: FairPintDrawn | null; error: string; retryAt: number };
export type FairPintPlanEvent = { type: "draw"; request: number } | { type: "drawn"; request: number; last: FairPintDrawn } | { type: "failed"; request: number; error: string; retryAt: number } | { type: "back" };
export function transitionFairPintPlan(state: FairPintPlanState, event: FairPintPlanEvent): FairPintPlanState {
  switch (event.type) {
    case "draw": return { ...state, phase: "drawing", request: event.request, error: "", retryAt: 0 };
    case "drawn": return state.request !== event.request ? state : { ...state, phase: "result", last: event.last, error: "" };
    case "failed": return state.request !== event.request ? state : { ...state, phase: state.last ? "result" : "dial", error: event.error, retryAt: event.retryAt };
    case "back": return { ...state, phase: "dial" };
    default: { const never: never = event; return never; }
  }
}
